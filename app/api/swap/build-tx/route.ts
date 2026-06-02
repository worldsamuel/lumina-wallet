import { NextRequest } from "next/server";
import { isAddress, parseUnits, type Address } from "viem";
import type { PermitSingle } from "@uniswap/permit2-sdk";
import { jsonResponse, optionsResponse } from "@/lib/api/cors";
import { rateLimit } from "@/lib/api/rate-limit";
import type { OnchainPricesResponse } from "@/lib/prices";
import { buildSwapTransaction } from "@/lib/swap/build-swap-tx";
import { UNIVERSAL_ROUTER_ADDRESS } from "@/lib/swap/contracts";
import type { SignedPermit2 } from "@/lib/swap/permit2-sign";
import { resolveSafeSwapToken } from "@/lib/swap/token-safety";
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
  permit?: PermitSingle;
  signature?: string;
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

  const amountUsd = await estimateAmountUsd(req, parsed.from.priceSymbol, parsed.amountText);
  const maxUsd = getSwapMaxUsd();
  if (amountUsd === null) {
    return jsonResponse({ error: "Unable to verify swap USD limit. Please try again later." }, { status: 503 });
  }
  if (amountUsd > maxUsd) {
    return jsonResponse({ error: `Single swap limit is $${maxUsd}. Please reduce the amount.` }, { status: 400 });
  }

  const quote = await quoteBestV3(parsed.from, parsed.to, parsed.fromAmount);
  if (!quote.bestQuote || BigInt(quote.bestQuote.amountOutRaw) <= 0n) {
    return jsonResponse({ error: "No executable Uniswap V3 route for this pair." }, { status: 404 });
  }

  const tx = await buildSwapTransaction({
    fromToken: parsed.from,
    toToken: parsed.to,
    fromAmount: parsed.fromAmount,
    expectedAmountOut: BigInt(quote.bestQuote.amountOutRaw),
    feeTier: quote.bestQuote.fee,
    slippageBps: parsed.slippageBps,
    userAddress: parsed.userAddress,
    deadline: parsed.deadline,
    permit: parsed.permit,
    signature: parsed.signature,
  });

  return jsonResponse({
    tx,
    quote: {
      source: "uniswap-v3",
      amountIn: parsed.amountText,
      amountOut: quote.bestQuote.amountOut,
      amountOutRaw: quote.bestQuote.amountOutRaw,
      feeTier: quote.bestQuote.fee,
      gasEstimate: quote.bestQuote.gasEstimate,
      tokens: {
        from: parsed.from,
        to: parsed.to,
      },
    },
    permit2Spender: UNIVERSAL_ROUTER_ADDRESS,
    deadline: parsed.deadline,
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

  const signature = String(body?.signature ?? "");
  if (!/^0x[0-9a-fA-F]+$/.test(signature)) return { error: "Missing Permit2 signature.", status: 400 as const };
  const permit = body?.permit;
  if (!isValidPermit(permit, from.address, userAddress as Address)) {
    return { error: "Invalid Permit2 payload.", status: 400 as const };
  }

  try {
    const fromAmount = parseUnits(amountText, from.decimals);
    if (fromAmount <= 0n) return { error: "Enter an amount greater than 0.", status: 400 as const };
    if (BigInt(String(permit.details.amount)) < fromAmount) {
      return { error: "Permit2 amount is below swap amount.", status: 400 as const };
    }
    const deadline = Number(permit.sigDeadline);
    if (!Number.isFinite(deadline) || deadline <= Math.floor(Date.now() / 1000)) {
      return { error: "Permit2 signature is expired.", status: 400 as const };
    }
    return {
      from,
      to,
      amountText,
      fromAmount,
      slippageBps,
      userAddress: userAddress as Address,
      permit,
      signature: signature as SignedPermit2["signature"],
      deadline,
    };
  } catch {
    return { error: "Invalid token amount.", status: 400 as const };
  }
}

function isValidPermit(permit: unknown, token: Address, owner: Address): permit is PermitSingle {
  const candidate = permit as PermitSingle | undefined;
  if (!candidate?.details) return false;
  if (String(candidate.details.token).toLowerCase() !== token.toLowerCase()) return false;
  if (String(candidate.spender).toLowerCase() !== UNIVERSAL_ROUTER_ADDRESS.toLowerCase()) return false;
  if (!candidate.details.amount || !candidate.details.nonce || !candidate.details.expiration || !candidate.sigDeadline) return false;
  void owner;
  return true;
}

async function estimateAmountUsd(req: NextRequest, priceSymbol: string, amountText: string) {
  const amount = Number(amountText);
  if (!Number.isFinite(amount) || amount <= 0) return null;
  const price = await fetchJson<OnchainPricesResponse>(req, "/api/prices/onchain")
    .then((prices) => priceUsd(prices, priceSymbol))
    .catch(() => null);
  return price ? amount * price : null;
}

function priceUsd(prices: OnchainPricesResponse | null, symbol: string) {
  const value = prices?.[symbol as keyof OnchainPricesResponse];
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : null;
}

async function fetchJson<T>(req: NextRequest, path: string): Promise<T> {
  const response = await fetch(new URL(path, req.url), { cache: "no-store" });
  if (!response.ok) throw new Error(`${path} responded ${response.status}`);
  return (await response.json()) as T;
}

function getSwapMaxUsd() {
  const value = Number(process.env.NEXT_PUBLIC_SWAP_MAX_USD || "5");
  return Number.isFinite(value) && value > 0 ? Math.min(value, 5) : 5;
}
