import { NextRequest } from "next/server";
import { jsonResponse, optionsResponse } from "@/lib/api/cors";
import { rateLimit } from "@/lib/api/rate-limit";
import { getWorldChainMarketForToken } from "@/lib/market-data";

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
    return jsonResponse({ market: null });
  }

  const market = await getWorldChainMarketForToken(address, symbol).catch(() => {
    console.warn("[market/token] unavailable");
    return null;
  });

  return jsonResponse({ market });
}
