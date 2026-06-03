import { NextRequest } from "next/server";
import { jsonResponse, optionsResponse } from "@/lib/api/cors";
import { rateLimit } from "@/lib/api/rate-limit";
import { getWorldChainMarketForToken } from "@/lib/market-data";
import { getTokenLogoAddress } from "@/lib/tokens";

export const runtime = "edge";

export function OPTIONS() {
  return optionsResponse();
}

export async function GET(req: NextRequest) {
  if (!rateLimit(req, "public:market-token", 120).ok) {
    return jsonResponse({ error: "Too many requests." }, { status: 429 });
  }

  const symbol = (req.nextUrl.searchParams.get("symbol") ?? "").toUpperCase();
  const requestedAddress = req.nextUrl.searchParams.get("address") ?? "";
  const address = /^0x[a-fA-F0-9]{40}$/.test(requestedAddress)
    ? requestedAddress
    : symbol
      ? getTokenLogoAddress(symbol)
      : null;

  if (!address) return jsonResponse({ symbol, market: null });

  const market = await getWorldChainMarketForToken(address, symbol);
  return jsonResponse({ symbol, market });
}
