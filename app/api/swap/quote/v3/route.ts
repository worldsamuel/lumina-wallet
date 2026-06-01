import { NextRequest } from "next/server";
import { parseUnits } from "viem";
import { jsonResponse, optionsResponse } from "@/lib/api/cors";
import { rateLimit } from "@/lib/api/rate-limit";
import { quoteBestV3 } from "@/lib/swap/v3-quoter";
import { resolveSwapToken } from "@/lib/swap/tokens";

const CACHE_TTL_MS = 5_000;
const cache = new Map<string, { expiresAt: number; data: unknown }>();

type QuoteBody = {
  fromSymbol?: string;
  toSymbol?: string;
  fromAmount?: string;
};

export function OPTIONS() {
  return optionsResponse();
}

export async function POST(req: NextRequest) {
  if (!rateLimit(req, "public:swap-quote-v3", 180).ok) {
    return jsonResponse({ error: "Too many requests." }, { status: 429 });
  }

  const body = (await req.json().catch(() => null)) as QuoteBody | null;
  const parsed = parseQuoteBody(body);
  if ("error" in parsed) return jsonResponse({ error: parsed.error }, { status: 400 });

  const cacheKey = `${parsed.from.symbol}:${parsed.to.symbol}:${parsed.amountIn.toString()}`;
  const cached = cache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) return quoteResponse(cached.data);

  const data = {
    source: "uniswap-v3",
    ...(await quoteBestV3(parsed.from, parsed.to, parsed.amountIn)),
  };
  cache.set(cacheKey, { data, expiresAt: Date.now() + CACHE_TTL_MS });
  return quoteResponse(data);
}

function parseQuoteBody(body: QuoteBody | null) {
  const from = resolveSwapToken(body?.fromSymbol);
  const to = resolveSwapToken(body?.toSymbol);
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
    headers: {
      "Cache-Control": "public, s-maxage=5, stale-while-revalidate=5",
    },
  });
}
