import { NextRequest } from "next/server";
import { jsonResponse, optionsResponse } from "@/lib/api/cors";
import { rateLimit } from "@/lib/api/rate-limit";
import { getWorldChainMarketForToken } from "@/lib/market-data";

const MARKET_CACHE_HEADERS = {
  "Cache-Control": "private, no-store, max-age=0, must-revalidate",
  "CDN-Cache-Control": "no-store",
  "Vercel-CDN-Cache-Control": "no-store",
};

export const dynamic = "force-dynamic";
export const revalidate = 0;

export function OPTIONS() {
  return optionsResponse();
}

export async function GET(req: NextRequest) {
  if (!rateLimit(req, "public:market-token", 120).ok) {
    return jsonResponse({ error: "Too many requests." }, { status: 429 });
  }

  const address = req.nextUrl.searchParams.get("address") ?? "";
  const symbol = req.nextUrl.searchParams.get("symbol") ?? "";
  if (!/^0x[a-fA-F0-9]{40}$/.test(address)) {
    return marketJson({ market: null });
  }

  const market = await getWorldChainMarketForToken(address, symbol).catch(() => {
    console.warn("[market/token] unavailable");
    return null;
  });

  return marketJson({ market });
}

function marketJson(data: unknown, init?: ResponseInit) {
  const headers = new Headers(init?.headers);
  Object.entries(MARKET_CACHE_HEADERS).forEach(([name, value]) => headers.set(name, value));
  return jsonResponse(data, { ...init, headers });
}
