import { NextRequest } from "next/server";
import { createHash } from "crypto";
import { mkdir, readFile, writeFile } from "fs/promises";
import { formatUnits, parseUnits } from "viem";
import { jsonResponse, optionsResponse } from "@/lib/api/cors";
import { rateLimit } from "@/lib/api/rate-limit";
import { publicClient } from "@/lib/chain";
import type { MarketPricesResponse, OnchainPricesResponse } from "@/lib/prices";
import type { SwapQuoteResult, SwapQuoteSet } from "@/lib/swap/quote-types";
import { resolveSafeSwapToken } from "@/lib/swap/token-safety";
import type { SwapToken } from "@/lib/swap/tokens";
import { quoteBestV3 } from "@/lib/swap/v3-quoter";
import { quoteBestV4 } from "@/lib/swap/v4-quoter";
import { applySwapOutputFee, getSwapPlatformFeeConfig } from "@/lib/swap/platform-fee";
import {
  holdstationFeePercent,
  holdstationFeeReceiver,
  quoteHoldstation,
  slippageBpsToPercent,
} from "@/lib/swap/holdstation-client";

type QuoteBody = {
  fromSymbol?: string;
  toSymbol?: string;
  fromToken?: string;
  toToken?: string;
  fromAmount?: string;
  slippageBps?: number;
};

type SourceQuote = {
  source: "uniswap-v3" | "uniswap-v4";
  bestQuote: SwapQuoteResult | null;
  allQuotes: SwapQuoteSet["allQuotes"];
};

type HoldstationQuote = NonNullable<Awaited<ReturnType<typeof buildHoldstationQuote>>>;
type QuoteCacheEntry = { expiresAt: number; staleUntil: number; data: unknown };

const QUOTE_CACHE_TTL_MS = 8_000;
const QUOTE_CACHE_STALE_MS = 90_000;
const QUOTE_FILE_CACHE_DIR = "/tmp/lumina-swap-quote-cache";
const quoteCacheStore = globalThis as typeof globalThis & {
  __luminaSwapQuoteCache?: Map<string, QuoteCacheEntry>;
};
const quoteCache = quoteCacheStore.__luminaSwapQuoteCache ?? new Map<string, QuoteCacheEntry>();
quoteCacheStore.__luminaSwapQuoteCache = quoteCache;

export function OPTIONS() {
  return optionsResponse();
}

export async function POST(req: NextRequest) {
  if (!rateLimit(req, "public:swap-quote", 120).ok) {
    return jsonResponse({ error: "Too many requests." }, { status: 429 });
  }

  const body = (await req.json().catch(() => null)) as QuoteBody | null;
  const parsed = await parseQuoteBody(body);
  if ("error" in parsed) return jsonResponse({ error: parsed.error }, { status: 400 });

  const grossAmountIn = parseUnits(parsed.amountText, parsed.from.decimals);
  const amountIn = grossAmountIn;
  const amountText = formatUnits(amountIn, parsed.from.decimals);
  const platformFeeConfig = getSwapPlatformFeeConfig();
  const cacheKey = [
    parsed.from.address.toLowerCase(),
    parsed.to.address.toLowerCase(),
    amountIn.toString(),
    parsed.slippageBps,
    platformFeeConfig?.bps ?? 0,
    process.env.NEXT_PUBLIC_SWAP_HOLDSTATION_EXECUTION === "true" ? "hs-exec" : "no-hs-exec",
    process.env.NEXT_PUBLIC_SWAP_HOLDSTATION_REFERENCE === "true" ? "hs-ref" : "no-hs-ref",
    process.env.NEXT_PUBLIC_SWAP_V4_REFERENCE !== "false" ? "v4-ref" : "no-v4-ref",
  ].join(":");
  const cached = quoteCache.get(cacheKey);
  const now = Date.now();
  if (cached && cached.expiresAt > now) {
    return jsonResponse(cached.data, {
      headers: {
        "Cache-Control": "private, max-age=5, stale-while-revalidate=30",
      },
    });
  }
  const diskCached = await readQuoteFileCache(cacheKey);
  if (diskCached && diskCached.expiresAt > now) {
    quoteCache.set(cacheKey, diskCached);
    return jsonResponse(diskCached.data, {
      headers: {
        "Cache-Control": "private, max-age=5, stale-while-revalidate=30",
        "X-Lumina-Quote-Cache": "shared",
      },
    });
  }

  const hasCommunityToken = parsed.from.trust === "community" || parsed.to.trust === "community";
  const reliableImpactReference = hasReliablePriceReference(parsed.from) && hasReliablePriceReference(parsed.to);
  const enableHoldstationReference =
    process.env.NEXT_PUBLIC_SWAP_HOLDSTATION_EXECUTION === "true" ||
    process.env.NEXT_PUBLIC_SWAP_HOLDSTATION_REFERENCE === "true";
  const enableV4Reference = process.env.NEXT_PUBLIC_SWAP_V4_REFERENCE !== "false";
  const [holdstation, v3, v4, chainlink, coingecko, gasPrice] = await Promise.all([
    enableHoldstationReference
      ? withTimeout(buildHoldstationQuote(parsed.from, parsed.to, parsed.amountText, parsed.slippageBps), 3_500).catch((error) => {
          console.warn("[SWAP] Holdstation quote failed", error);
          return null;
      })
      : Promise.resolve(null),
    buildV3QuoteWithRetry(parsed.from, parsed.to, amountIn),
    hasCommunityToken || !enableV4Reference
      ? Promise.resolve(null)
      : withTimeout(quoteBestV4(parsed.from, parsed.to, amountIn), 2_500)
          .then((quote) => ({ source: "uniswap-v4" as const, ...quote }))
          .catch(() => null),
    reliableImpactReference ? fetchJson<OnchainPricesResponse>(req, "/api/prices/onchain").catch(() => null) : Promise.resolve(null),
    reliableImpactReference ? fetchJson<MarketPricesResponse>(req, "/api/prices/market").catch(() => null) : Promise.resolve(null),
    reliableImpactReference ? publicClient.getGasPrice().catch(() => 0n) : Promise.resolve(0n),
  ]);

  const amountInNumber = Number(amountText);
  const main = pickMainQuote(holdstation, v3, v4);
  const chainlinkRate = referenceRate(parsed.from, parsed.to, chainlink);
  const coingeckoRate = referenceRate(parsed.from, parsed.to, coingecko);

  if (!main || !main.quote || Number(main.quote.amountOut) <= 0) {
    const staleCache = [cached, diskCached].find((entry): entry is QuoteCacheEntry => Boolean(entry && entry.staleUntil > Date.now()));
    if (staleCache) {
      quoteCache.set(cacheKey, staleCache);
      return jsonResponse(withStaleQuote(staleCache.data), {
        headers: {
          "Cache-Control": "private, no-store",
          "X-Lumina-Stale-Quote": "1",
        },
      });
    }
    return jsonResponse(
      {
        error: "No executable swap route for this pair.",
        references: buildReferences(parsed.from, parsed.to, amountInNumber, holdstation, v3, v4, chainlink, coingecko),
        warnings: ["low_liquidity"],
        blocked: true,
        blockReason: "No executable swap route for this pair.",
      },
      { status: 404 },
    );
  }

  const grossAmountOutRaw = BigInt(main.quote.amountOutRaw);
  const { netAmountOut, payload: platformFee } =
    main.source === "holdstation"
      ? holdstationOutputFeePayload(parsed.to, grossAmountOutRaw, main.feeAmountOutRaw, platformFeeConfig)
      : applySwapOutputFee(parsed.to, grossAmountOutRaw, platformFeeConfig);
  const amountOut = formatUnits(netAmountOut, parsed.to.decimals);
  const amountOutNumber = Number(amountOut);
  const quoteRate = amountInNumber > 0 ? amountOutNumber / amountInNumber : null;
  const roundTripLossPercent =
    hasCommunityToken || !reliableImpactReference
      ? await estimateRoundTripLossPercent(parsed.from, parsed.to, amountIn, netAmountOut)
      : null;
  const deviationValues = reliableImpactReference
    ? [deviation(quoteRate, chainlinkRate), deviation(quoteRate, coingeckoRate)].filter((value): value is number => value !== null)
    : [];
  const closestDeviation = deviationValues.length ? Math.min(...deviationValues) : 0;
  const priceImpactPercent = reliableImpactReference && deviationValues.length ? closestDeviation : null;
  const warnings: string[] = [];
  if (priceImpactPercent !== null && closestDeviation > 0.05) warnings.push("price_anomaly");
  if (priceImpactPercent !== null && priceImpactPercent > 0.1) warnings.push("low_liquidity");
  if (roundTripLossPercent !== null && roundTripLossPercent > 0.15) warnings.push("low_liquidity");
  const blocked = Boolean(roundTripLossPercent !== null && roundTripLossPercent > 0.15);
  const blockReason = blocked ? "Pool liquidity is too thin. This swap may lose more than 15%." : undefined;

  const payload = {
    source: main.source,
    amountIn: amountText,
    amountInRaw: amountIn.toString(),
    grossAmountIn: parsed.amountText,
    amountOut,
    amountOutRaw: netAmountOut.toString(),
    grossAmountOut: main.quote.amountOut,
    grossAmountOutRaw: grossAmountOutRaw.toString(),
    rate: quoteRate,
    priceImpactPercent: priceImpactPercent === null ? null : Number((priceImpactPercent * 100).toFixed(4)),
    priceImpactLevel: priceImpactPercent === null ? "unknown" : impactLevel(priceImpactPercent * 100),
    priceImpactAvailable: priceImpactPercent !== null,
    roundTripLossPercent: roundTripLossPercent === null ? null : Number((roundTripLossPercent * 100).toFixed(4)),
    gasEstimateUsd: gasUsd(main.quote.gasEstimate, gasPrice, chainlink?.ETH),
    feeTier: main.quote.fee,
    route: main.quote.route,
    tx: main.source === "holdstation" ? main.tx : undefined,
    addons: main.source === "holdstation" ? main.addons : undefined,
    platformFee,
    tokens: {
      from: tokenPayload(parsed.from),
      to: tokenPayload(parsed.to),
    },
    references: buildReferences(parsed.from, parsed.to, amountInNumber, holdstation, v3, v4, chainlink, coingecko, main.source),
    warnings,
    blocked,
    blockReason,
  };
  quoteCache.set(cacheKey, {
    data: payload,
    expiresAt: Date.now() + QUOTE_CACHE_TTL_MS,
    staleUntil: Date.now() + QUOTE_CACHE_STALE_MS,
  });
  await writeQuoteFileCache(cacheKey, quoteCache.get(cacheKey)!);
  if (quoteCache.size > 400) {
    const now = Date.now();
    for (const [key, value] of quoteCache) {
      if (value.staleUntil <= now || quoteCache.size > 300) quoteCache.delete(key);
    }
  }

  return jsonResponse(
    payload,
    {
      headers: {
        "Cache-Control": "private, max-age=5, stale-while-revalidate=30",
      },
    },
  );
}

function withStaleQuote(data: unknown) {
  if (!data || typeof data !== "object" || Array.isArray(data)) return data;
  const record = data as Record<string, unknown>;
  const warnings = Array.isArray(record.warnings) ? record.warnings.filter((item): item is string => typeof item === "string") : [];
  return {
    ...record,
    stale: true,
    warnings: Array.from(new Set([...warnings, "stale_quote"])),
  };
}

async function buildV3QuoteWithRetry(from: SwapToken, to: SwapToken, amountIn: bigint): Promise<SourceQuote | null> {
  const attempts = [3_500, 3_000];
  for (let index = 0; index < attempts.length; index += 1) {
    try {
      const quote = await withTimeout(quoteBestV3(from, to, amountIn), attempts[index]);
      if (quote.bestQuote && Number(quote.bestQuote.amountOut) > 0) {
        return { source: "uniswap-v3", ...quote };
      }
    } catch {
      // Retry once because World Chain quoter/RPC occasionally returns a transient miss.
    }
    if (index < attempts.length - 1) await sleep(120);
  }
  return null;
}

async function estimateRoundTripLossPercent(from: SwapToken, to: SwapToken, amountIn: bigint, amountOut: bigint) {
  if (amountIn <= 0n || amountOut <= 0n) return null;
  try {
    const reverse = await withTimeout(quoteBestV3(to, from, amountOut), 2_500);
    const reverseOutRaw = reverse.bestQuote?.amountOutRaw;
    if (!reverseOutRaw) return null;
    const reverseOut = BigInt(reverseOutRaw);
    if (reverseOut >= amountIn) return 0;
    const lossBps = Number(((amountIn - reverseOut) * 10_000n) / amountIn);
    return lossBps / 10_000;
  } catch {
    return null;
  }
}

async function readQuoteFileCache(cacheKey: string): Promise<QuoteCacheEntry | null> {
  try {
    const data = JSON.parse(await readFile(quoteFileCachePath(cacheKey), "utf8")) as QuoteCacheEntry;
    if (!data || typeof data !== "object" || data.staleUntil <= Date.now()) return null;
    return data;
  } catch {
    return null;
  }
}

async function writeQuoteFileCache(cacheKey: string, data: QuoteCacheEntry) {
  try {
    await mkdir(QUOTE_FILE_CACHE_DIR, { recursive: true });
    await writeFile(quoteFileCachePath(cacheKey), JSON.stringify(data), "utf8");
  } catch (error) {
    console.warn("[SWAP] shared quote cache write failed", error);
  }
}

function quoteFileCachePath(cacheKey: string) {
  return `${QUOTE_FILE_CACHE_DIR}/${createHash("sha256").update(cacheKey).digest("hex")}.json`;
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function parseQuoteBody(body: QuoteBody | null) {
  const from = await resolveSafeSwapToken(body?.fromToken ?? body?.fromSymbol);
  const to = await resolveSafeSwapToken(body?.toToken ?? body?.toSymbol);
  if (!from || !to) return { error: "Unsupported token." };
  if (from.address.toLowerCase() === to.address.toLowerCase()) return { error: "Choose two different tokens." };

  const amountText = String(body?.fromAmount ?? "").replace(/,/g, "").trim();
  if (!amountText || Number(amountText) <= 0) return { error: "Enter a valid amount." };
  try {
    parseUnits(amountText, from.decimals);
    const slippageBps = Number(body?.slippageBps ?? 50);
    return {
      from,
      to,
      amountText,
      slippageBps: Number.isFinite(slippageBps) && slippageBps > 0 ? Math.min(Math.round(slippageBps), 1_000) : 50,
    };
  } catch {
    return { error: "Invalid token amount." };
  }
}

function tokenPayload(token: SwapToken) {
  return {
    symbol: token.symbol,
    name: token.name,
    address: token.address,
    decimals: token.decimals,
    trust: token.trust ?? "core",
    safety: token.safety ?? null,
  };
}

async function buildHoldstationQuote(from: SwapToken, to: SwapToken, amountText: string, slippageBps: number) {
  const quote = await quoteHoldstation({
    tokenIn: from.address,
    tokenOut: to.address,
    amountIn: amountText,
    slippage: slippageBpsToPercent(slippageBps),
    fee: holdstationFeePercent(),
    feeReceiver: holdstationFeeReceiver(),
  });
  const amountOutRaw = parseUnitsSafe(String(quote.addons?.outAmount ?? "0"), to.decimals);
  if (amountOutRaw <= 0n) return null;
  return {
    source: "holdstation" as const,
    quote,
    amountOutRaw,
    amountOut: formatUnits(amountOutRaw, to.decimals),
    feeAmountOutRaw: BigInt(quote.addons?.feeAmountOut ?? "0x0"),
  };
}

function pickMainQuote(holdstation: HoldstationQuote | null, v3: SourceQuote | null, v4: SourceQuote | null) {
  if (v3?.bestQuote) return { source: "uniswap-v3" as const, quote: v3.bestQuote };
  if (process.env.NEXT_PUBLIC_SWAP_HOLDSTATION_EXECUTION === "true" && holdstation?.quote && holdstation.amountOutRaw > 0n) {
    const netRaw = holdstation.amountOutRaw > holdstation.feeAmountOutRaw ? holdstation.amountOutRaw - holdstation.feeAmountOutRaw : holdstation.amountOutRaw;
    return {
      source: "holdstation" as const,
      quote: {
        amountOut: holdstation.amountOut,
        amountOutRaw: holdstation.amountOutRaw.toString(),
        fee: 0,
        route: { tokens: [], fees: [] },
        gasEstimate: "0",
      },
      tx: {
        to: holdstation.quote.to,
        data: holdstation.quote.data,
        value: holdstation.quote.value ?? "0",
      },
      addons: holdstation.quote.addons,
      feeAmountOutRaw: holdstation.feeAmountOutRaw,
    };
  }
  // Holdstation is currently kept as a reference quote unless explicitly enabled.
  // Its SDK execution can fail inside World App even when quote calldata exists.
  // Keep V4 as a reference quote only until the execution path supports V4 calldata.
  // Returning it as the main quote makes the UI look executable, then build-tx fails.
  return null;
}

function buildReferences(
  from: SwapToken,
  to: SwapToken,
  amountIn: number,
  holdstation: HoldstationQuote | null,
  v3: SourceQuote | null,
  v4: SourceQuote | null,
  chainlink: OnchainPricesResponse | null,
  coingecko: MarketPricesResponse | null,
  selected?: "holdstation" | "uniswap-v3" | "uniswap-v4",
) {
  return {
    holdstation: holdstationReference(holdstation, amountIn, selected === "holdstation"),
    uniswapV3: quoteReference(v3, amountIn, selected === "uniswap-v3"),
    uniswapV4: quoteReference(v4, amountIn, selected === "uniswap-v4"),
    chainlink: { rate: referenceRate(from, to, chainlink), updatedAt: chainlink?.updatedAt ?? null },
    coingecko: { rate: referenceRate(from, to, coingecko), updatedAt: coingecko?.updated_at ?? null },
  };
}

function holdstationReference(quote: HoldstationQuote | null, amountIn: number, selected: boolean) {
  const amountOut = Number(quote?.amountOut ?? 0);
  return {
    rate: amountIn > 0 && amountOut > 0 ? amountOut / amountIn : null,
    available: Boolean(quote?.quote && amountOut > 0),
    selected,
  };
}

function holdstationOutputFeePayload(
  to: SwapToken,
  grossAmountOut: bigint,
  feeAmountOut: bigint,
  config: ReturnType<typeof getSwapPlatformFeeConfig>,
) {
  if (!config || feeAmountOut <= 0n) return { netAmountOut: grossAmountOut, payload: null };
  const netAmountOut = grossAmountOut > feeAmountOut ? grossAmountOut - feeAmountOut : grossAmountOut;
  return {
    netAmountOut,
    payload: {
      businessType: "swap" as const,
      token: to.address,
      recipient: config.recipient,
      percent: config.percent,
      bps: config.bps,
      amountRaw: feeAmountOut.toString(),
      amount: formatUnits(feeAmountOut, to.decimals),
    },
  };
}

function parseUnitsSafe(value: string, decimals: number) {
  const [whole, fraction = ""] = String(value || "0").split(".");
  return parseUnits(`${whole || "0"}${fraction ? `.${fraction.slice(0, decimals)}` : ""}`, decimals);
}

function quoteReference(quote: SourceQuote | null, amountIn: number, selected: boolean) {
  const amountOut = Number(quote?.bestQuote?.amountOut ?? 0);
  return {
    rate: amountIn > 0 && amountOut > 0 ? amountOut / amountIn : null,
    available: Boolean(quote?.bestQuote && amountOut > 0),
    selected,
  };
}

function referenceRate(from: SwapToken, to: SwapToken, prices?: OnchainPricesResponse | MarketPricesResponse | null) {
  const fromUsd = priceUsd(prices, from.priceSymbol);
  const toUsd = priceUsd(prices, to.priceSymbol);
  return fromUsd && toUsd ? fromUsd / toUsd : null;
}

function priceUsd(prices: OnchainPricesResponse | MarketPricesResponse | null | undefined, symbol: SwapToken["priceSymbol"]) {
  const value = prices?.[symbol];
  if (typeof value === "number" && Number.isFinite(value) && value > 0) return value;
  if (typeof value === "object" && value && "usd" in value && typeof value.usd === "number" && value.usd > 0) {
    return value.usd;
  }
  return null;
}

function hasReliablePriceReference(token: SwapToken) {
  const symbol = token.symbol.toUpperCase();
  const priceSymbol = token.priceSymbol.toUpperCase();
  if (symbol === priceSymbol) return true;
  if (symbol === "WETH" && priceSymbol === "ETH") return true;
  if ((symbol === "WBTC" || symbol === "BTC") && priceSymbol === "BTC") return true;
  if ((symbol === "USDT" || symbol === "EURC") && priceSymbol === "USDC") return true;
  return false;
}

function deviation(value: number | null, reference: number | null) {
  if (!value || !reference) return null;
  return Math.abs(value - reference) / reference;
}

function impactLevel(percent: number) {
  if (percent < 0.5) return "green";
  if (percent < 3) return "yellow";
  if (percent < 10) return "orange";
  return "red";
}

function gasUsd(gasEstimate: string, gasPriceWei: bigint, ethUsd: unknown) {
  const ethPrice = typeof ethUsd === "number" && Number.isFinite(ethUsd) ? ethUsd : 0;
  if (!ethPrice || !gasPriceWei) return 0;
  return Number(((BigInt(gasEstimate || "0") * gasPriceWei * BigInt(Math.round(ethPrice * 100))) / 10n ** 18n)) / 100;
}

async function fetchJson<T>(req: NextRequest, path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(new URL(path, req.url), init);
  if (!response.ok) throw new Error(`${path} responded ${response.status}`);
  return (await response.json()) as T;
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number) {
  return Promise.race([
    promise,
    new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error("quote_timeout")), timeoutMs);
    }),
  ]);
}
