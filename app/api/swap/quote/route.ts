import { NextRequest } from "next/server";
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
import { getSwapPlatformFee } from "@/lib/swap/platform-fee";

type QuoteBody = {
  fromSymbol?: string;
  toSymbol?: string;
  fromToken?: string;
  toToken?: string;
  fromAmount?: string;
};

type SourceQuote = {
  source: "uniswap-v3" | "uniswap-v4";
  bestQuote: SwapQuoteResult | null;
  allQuotes: SwapQuoteSet["allQuotes"];
};

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
  const platformFee = await getSwapPlatformFee(parsed.from, grossAmountIn);
  const amountIn = platformFee?.swapAmount ?? grossAmountIn;
  const amountText = formatUnits(amountIn, parsed.from.decimals);
  const hasCommunityToken = parsed.from.trust === "community" || parsed.to.trust === "community";
  const reliableImpactReference = hasReliablePriceReference(parsed.from) && hasReliablePriceReference(parsed.to);
  const [v3, v4, chainlink, coingecko, gasPrice] = await Promise.all([
    withTimeout(quoteBestV3(parsed.from, parsed.to, amountIn), 6_000)
      .then((quote) => ({ source: "uniswap-v3" as const, ...quote }))
      .catch(() => null),
    hasCommunityToken
      ? Promise.resolve(null)
      : withTimeout(quoteBestV4(parsed.from, parsed.to, amountIn), 6_000)
          .then((quote) => ({ source: "uniswap-v4" as const, ...quote }))
          .catch(() => null),
    reliableImpactReference ? fetchJson<OnchainPricesResponse>(req, "/api/prices/onchain").catch(() => null) : Promise.resolve(null),
    reliableImpactReference ? fetchJson<MarketPricesResponse>(req, "/api/prices/market").catch(() => null) : Promise.resolve(null),
    reliableImpactReference ? publicClient.getGasPrice().catch(() => 0n) : Promise.resolve(0n),
  ]);

  const amountInNumber = Number(amountText);
  const main = pickMainQuote(v3, v4);
  const chainlinkRate = referenceRate(parsed.from, parsed.to, chainlink);
  const coingeckoRate = referenceRate(parsed.from, parsed.to, coingecko);

  if (!main || !main.quote || Number(main.quote.amountOut) <= 0) {
    return jsonResponse(
      {
        error: "No executable Uniswap route for this pair.",
        references: buildReferences(parsed.from, parsed.to, amountInNumber, v3, v4, chainlink, coingecko),
        warnings: ["low_liquidity"],
        blocked: true,
        blockReason: "No executable Uniswap route for this pair.",
      },
      { status: 404 },
    );
  }

  const amountOutNumber = Number(main.quote.amountOut);
  const quoteRate = amountInNumber > 0 ? amountOutNumber / amountInNumber : null;
  const deviationValues = reliableImpactReference
    ? [deviation(quoteRate, chainlinkRate), deviation(quoteRate, coingeckoRate)].filter((value): value is number => value !== null)
    : [];
  const closestDeviation = deviationValues.length ? Math.min(...deviationValues) : 0;
  const priceImpactPercent = reliableImpactReference && deviationValues.length ? closestDeviation : null;
  const warnings: string[] = [];
  if (priceImpactPercent !== null && closestDeviation > 0.05) warnings.push("price_anomaly");
  if (priceImpactPercent !== null && priceImpactPercent > 0.1) warnings.push("low_liquidity");

  return jsonResponse(
    {
      source: main.source,
      amountIn: amountText,
      amountInRaw: amountIn.toString(),
      grossAmountIn: parsed.amountText,
      amountOut: main.quote.amountOut,
      amountOutRaw: main.quote.amountOutRaw,
      rate: quoteRate,
      priceImpactPercent: priceImpactPercent === null ? null : Number((priceImpactPercent * 100).toFixed(4)),
      priceImpactLevel: priceImpactPercent === null ? "unknown" : impactLevel(priceImpactPercent * 100),
      priceImpactAvailable: priceImpactPercent !== null,
      gasEstimateUsd: gasUsd(main.quote.gasEstimate, gasPrice, chainlink?.ETH),
      feeTier: main.quote.fee,
      route: main.quote.route,
      platformFee: platformFee?.payload ?? null,
      tokens: {
        from: tokenPayload(parsed.from),
        to: tokenPayload(parsed.to),
      },
      references: buildReferences(parsed.from, parsed.to, amountInNumber, v3, v4, chainlink, coingecko, main.source),
      warnings,
      blocked: false,
      blockReason: undefined,
    },
    {
      headers: {
        "Cache-Control": "public, s-maxage=5, stale-while-revalidate=5",
      },
    },
  );
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
    return { from, to, amountText };
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

function pickMainQuote(v3: SourceQuote | null, v4: SourceQuote | null) {
  const candidates = [
    v3?.bestQuote ? { source: "uniswap-v3" as const, quote: v3.bestQuote } : null,
    v4?.bestQuote ? { source: "uniswap-v4" as const, quote: v4.bestQuote } : null,
  ].filter((item): item is { source: "uniswap-v3" | "uniswap-v4"; quote: SwapQuoteResult } => Boolean(item));
  const executable = candidates.find((item) => item.source === "uniswap-v3");
  if (executable) return executable;
  return candidates.sort((a, b) => {
    const left = BigInt(a.quote.amountOutRaw);
    const right = BigInt(b.quote.amountOutRaw);
    return left > right ? -1 : left < right ? 1 : 0;
  })[0] ?? null;
}

function buildReferences(
  from: SwapToken,
  to: SwapToken,
  amountIn: number,
  v3: SourceQuote | null,
  v4: SourceQuote | null,
  chainlink: OnchainPricesResponse | null,
  coingecko: MarketPricesResponse | null,
  selected?: "uniswap-v3" | "uniswap-v4",
) {
  return {
    uniswapV3: quoteReference(v3, amountIn, selected === "uniswap-v3"),
    uniswapV4: quoteReference(v4, amountIn, selected === "uniswap-v4"),
    chainlink: { rate: referenceRate(from, to, chainlink), updatedAt: chainlink?.updatedAt ?? null },
    coingecko: { rate: referenceRate(from, to, coingecko), updatedAt: coingecko?.updated_at ?? null },
  };
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
