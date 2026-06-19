import { NextRequest } from "next/server";
import { parseUnits } from "viem";
import { jsonResponse, optionsResponse } from "@/lib/api/cors";
import { rateLimit } from "@/lib/api/rate-limit";
import { quoteBestV3 } from "@/lib/swap/v3-quoter";
import { resolveSafeSwapToken } from "@/lib/swap/token-safety";

const CACHE_TTL_MS = 5_000;
const QUOTE_HEADERS = {
  "Cache-Control": "private, no-store, max-age=0, must-revalidate",
  "CDN-Cache-Control": "no-store",
  "Vercel-CDN-Cache-Control": "no-store",
};
const cache = new Map<string, { expiresAt: number; data: unknown }>();

type QuoteBody = {
  fromSymbol?: string;
  toSymbol?: string;
  fromToken?: string;
  toToken?: string;
  fromAmount?: string;
};

export const dynamic = "force-dynamic";
export const revalidate = 0;

export function OPTIONS() {
  return optionsResponse();
}

export async function POST(req: NextRequest) {
  if (!rateLimit(req, "public:swap-quote-v3", 180).ok) {
    return jsonResponse({ error: "Too many requests." }, { status: 429 });
  }

  const body = (await req.json().catch(() => null)) as QuoteBody | null;
  const parsed = await parseQuoteBody(body);
  if ("error" in parsed) return jsonResponse({ error: parsed.error }, { status: 400 });

  const cacheKey = `${parsed.from.address}:${parsed.to.address}:${parsed.amountIn.toString()}`;
  const cached = cache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) return quoteResponse(cached.data);

  const data = {
    source: "uniswap-v3",
    ...(await quoteBestV3(parsed.from, parsed.to, parsed.amountIn)),
  };
  cache.set(cacheKey, { data, expiresAt: Date.now() + CACHE_TTL_MS });
  return quoteResponse(data);
}

async function parseQuoteBody(body: QuoteBody | null) {
  const from = await resolveSafeSwapToken(body?.fromToken ?? body?.fromSymbol);
  const to = await resolveSafeSwapToken(body?.toToken ?? body?.toSymbol);
  if (!from || !to) return { error: "Unsupported token." };
  if (from.address.toLowerCase() === to.address.toLowerCase()) return { error: "Choose two different tokens." };

  const amountText = String(body?.fromAmount ?? "").replace(/,/g, "").trim();
  if (!amountText || Number(amountText) <= 0) return { error: "Enter a valid amount." };
  try {
    return { from, to, amountIn: parseUnits(amountText, from.decimals) };
  } catch {
    return { error: "Invalid token amount." };
  }
}

function quoteResponse(data: unknown) {
  return jsonResponse(data, {
    headers: QUOTE_HEADERS,
  });
}
