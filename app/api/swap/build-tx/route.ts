import { NextRequest } from "next/server";
import { formatUnits, isAddress, parseUnits, type Address } from "viem";
import { jsonResponse, optionsResponse } from "@/lib/api/cors";
import { rateLimit } from "@/lib/api/rate-limit";
import { getWorldChainMarketForToken } from "@/lib/market-data";
import type { OnchainPricesResponse } from "@/lib/prices";
import { buildSwapTransaction } from "@/lib/swap/build-swap-tx";
import { UNIVERSAL_ROUTER_ADDRESS } from "@/lib/swap/contracts";
import { resolveSafeSwapToken } from "@/lib/swap/token-safety";
import { applySwapOutputFee, getSwapPlatformFeeConfig } from "@/lib/swap/platform-fee";
import type { SwapQuoteResult } from "@/lib/swap/quote-types";
import type { SwapToken } from "@/lib/swap/tokens";
import { quoteBestV3 } from "@/lib/swap/v3-quoter";

const MAX_PRICE_IMPACT_PERCENT = 15;

type BuildSwapBody = {
  fromToken?: string;
  toToken?: string;
  fromSymbol?: string;
  toSymbol?: string;
  fromAmount?: string;
  slippageBps?: number;
  userAddress?: string;
  quote?: {
    source?: string;
    amountInRaw?: string;
    amountOut?: string;
    amountOutRaw?: string;
    grossAmountOut?: string;
    grossAmountOutRaw?: string;
    feeTier?: number;
    route?: {
      tokens?: string[];
      fees?: number[];
    };
  };
  skipPlatformFee?: boolean;
};

export function OPTIONS() {
  return optionsResponse();
}

export async function POST(req: NextRequest) {
  if (!rateLimit(req, "public:swap-build-tx", 60).ok) {
    return jsonResponse({ error: "Too many requests." }, { status: 429 });
  }

  const body = (await req.json().catch(() => null)) as BuildSwapBody | null;
  const parsed = await parseBuildBody(body);
  if ("error" in parsed) return jsonResponse({ error: parsed.error }, { status: parsed.status ?? 400 });

  const quickAmountUsd = estimateAmountUsdFromQuote(body?.quote, parsed.from, parsed.to, parsed.fromAmount);
  const amountUsd = quickAmountUsd ?? (await estimateAmountUsd(req, parsed.from, parsed.amountText));
  const maxUsd = getSwapMaxUsd();
  if (amountUsd === null) {
    return jsonResponse({ error: "Unable to verify swap USD limit. Please try again later." }, { status: 503 });
  }
  if (amountUsd > maxUsd) {
    return jsonResponse({ error: `Single swap limit is $${maxUsd}. Please reduce the amount.` }, { status: 400 });
  }

  const amountIn = parsed.fromAmount;
  const platformFeeConfig = body?.skipPlatformFee ? null : getSwapPlatformFeeConfig();
  console.log("[SWAP] fee config:", platformFeeConfig);
  const clientQuote = trustedClientQuote(body?.quote, parsed.from, parsed.to, amountIn);
  const bestQuote = clientQuote ?? (await quoteBestV3(parsed.from, parsed.to, amountIn)).bestQuote;
  if (!bestQuote || BigInt(bestQuote.amountOutRaw) <= 0n) {
    return jsonResponse({ error: "No executable Uniswap V3 route for this pair." }, { status: 404 });
  }
  const grossAmountOutRaw = BigInt(bestQuote.amountOutRaw);
  const { netAmountOut, payload: platformFee } = applySwapOutputFee(parsed.to, grossAmountOutRaw, platformFeeConfig);

  const tx = await buildSwapTransaction({
    fromToken: parsed.from,
    toToken: parsed.to,
    fromAmount: amountIn,
    expectedAmountOut: netAmountOut,
    feeTier: bestQuote.fee,
    route: bestQuote.route,
    slippageBps: parsed.slippageBps,
    userAddress: parsed.userAddress,
    deadline: parsed.deadline,
    platformFee: platformFeeConfig,
  });

  return jsonResponse({
    tx,
    quote: {
      source: "uniswap-v3",
      amountIn: formatUnits(amountIn, parsed.from.decimals),
      amountInRaw: amountIn.toString(),
      grossAmountIn: parsed.amountText,
      amountOut: formatUnits(netAmountOut, parsed.to.decimals),
      amountOutRaw: netAmountOut.toString(),
      grossAmountOut: bestQuote.amountOut,
      grossAmountOutRaw: grossAmountOutRaw.toString(),
      feeTier: bestQuote.fee,
      route: bestQuote.route,
      gasEstimate: bestQuote.gasEstimate,
      tokens: {
        from: parsed.from,
        to: parsed.to,
      },
    },
    platformFee,
    permit2Spender: UNIVERSAL_ROUTER_ADDRESS,
    deadline: parsed.deadline,
    debug: {
      direction: `${parsed.from.symbol}->${parsed.to.symbol}`,
      inputToken: parsed.from.address,
      outputToken: parsed.to.address,
      amountInRaw: amountIn.toString(),
      expectedAmountOutRaw: netAmountOut.toString(),
      grossAmountOutRaw: grossAmountOutRaw.toString(),
      feeTier: bestQuote.fee,
      route: bestQuote.route,
      platformFeeConfig,
      platformFee,
      permit2Spender: UNIVERSAL_ROUTER_ADDRESS,
      deadline: parsed.deadline,
      txTo: tx.to,
      txValue: tx.value,
      txDataLength: tx.data.length,
    },
  });
}

async function parseBuildBody(body: BuildSwapBody | null) {
  const from = await resolveSafeSwapToken(body?.fromToken ?? body?.fromSymbol);
  const to = await resolveSafeSwapToken(body?.toToken ?? body?.toSymbol);
  if (!from || !to) return { error: "Unsupported token.", status: 400 as const };
  if (from.address.toLowerCase() === to.address.toLowerCase()) return { error: "Choose two different tokens.", status: 400 as const };

  const amountText = String(body?.fromAmount ?? "").replace(/,/g, "").trim();
  if (!amountText || Number(amountText) <= 0) return { error: "Enter a valid amount.", status: 400 as const };

  const slippageBps = Number(body?.slippageBps);
  if (!Number.isInteger(slippageBps) || slippageBps <= 0 || slippageBps > 1_000) {
    return { error: "Invalid slippage.", status: 400 as const };
  }

  const userAddress = String(body?.userAddress ?? "");
  if (!isAddress(userAddress)) return { error: "Invalid swap recipient.", status: 400 as const };

  try {
    const fromAmount = parseUnits(amountText, from.decimals);
    if (fromAmount <= 0n) return { error: "Enter an amount greater than 0.", status: 400 as const };
    const deadline = Math.floor(Date.now() / 1000) + 30 * 60;
    return {
      from,
      to,
      amountText,
      fromAmount,
      slippageBps,
      userAddress: userAddress as Address,
      deadline,
    };
  } catch {
    return { error: "Invalid token amount.", status: 400 as const };
  }
}

async function estimateAmountUsd(req: NextRequest, token: SwapToken, amountText: string) {
  const amount = Number(amountText);
  if (!Number.isFinite(amount) || amount <= 0) return null;
  if (token.trust === "community") {
    const marketPrice = await getWorldChainMarketForToken(token.address, token.symbol)
      .then((market) => market?.priceUsd ?? null)
      .catch(() => null);
    return marketPrice && marketPrice > 0 ? amount * marketPrice : 0;
  }
  const price = await fetchJson<OnchainPricesResponse>(req, "/api/prices/onchain")
    .then((prices) => priceUsd(prices, token.priceSymbol))
    .catch(() => null);
  return price ? amount * price : null;
}

function priceUsd(prices: OnchainPricesResponse | null, symbol: string) {
  const value = prices?.[symbol as keyof OnchainPricesResponse];
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : null;
}

function trustedClientQuote(
  quote: BuildSwapBody["quote"] | undefined,
  from: SwapToken,
  to: SwapToken,
  swapAmount: bigint,
): SwapQuoteResult | null {
  if (!quote || quote.source !== "uniswap-v3") return null;
  if (!quote.amountOutRaw || !quote.amountInRaw || quote.amountInRaw !== swapAmount.toString()) return null;
  const netAmountOutRaw = BigInt(quote.amountOutRaw);
  if (netAmountOutRaw <= 0n) return null;
  const amountOutRaw = BigInt(quote.grossAmountOutRaw || quote.amountOutRaw);
  if (amountOutRaw <= 0n) return null;
  const routeTokens = Array.isArray(quote.route?.tokens) ? quote.route.tokens : [];
  const routeFees = Array.isArray(quote.route?.fees) ? quote.route.fees : [];
  if (routeTokens.length >= 2) {
    if (routeTokens[0]?.toLowerCase() !== from.address.toLowerCase()) return null;
    if (routeTokens[routeTokens.length - 1]?.toLowerCase() !== to.address.toLowerCase()) return null;
    if (routeFees.length !== routeTokens.length - 1) return null;
  }
  const fee = Number(quote.feeTier);
  if (!Number.isInteger(fee) || fee <= 0) return null;
  return {
    amountOut: String(quote.grossAmountOut || quote.amountOut || ""),
    amountOutRaw: amountOutRaw.toString(),
    fee,
    route: routeTokens.length >= 2 ? { tokens: routeTokens, fees: routeFees } : undefined,
    gasEstimate: "0",
  };
}

function estimateAmountUsdFromQuote(
  quote: BuildSwapBody["quote"] | undefined,
  from: SwapToken,
  to: SwapToken,
  grossAmount: bigint,
) {
  if (!quote || !quote.amountOutRaw) return null;
  try {
    if (from.priceSymbol === "USDC") return Number(formatUnits(grossAmount, from.decimals));
    if (to.priceSymbol === "USDC") return Number(formatUnits(BigInt(quote.amountOutRaw), to.decimals));
    return null;
  } catch {
    return null;
  }
}

async function fetchJson<T>(req: NextRequest, path: string): Promise<T> {
  const response = await fetch(new URL(path, req.url), { cache: "no-store" });
  if (!response.ok) throw new Error(`${path} responded ${response.status}`);
  return (await response.json()) as T;
}

function getSwapMaxUsd() {
  const value = Number(process.env.NEXT_PUBLIC_SWAP_MAX_USD || "100000");
  return Number.isFinite(value) && value > 0 ? Math.min(value, 100000) : 100000;
}
