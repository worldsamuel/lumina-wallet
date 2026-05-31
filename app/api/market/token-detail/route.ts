import { NextRequest } from "next/server";
import { jsonResponse, optionsResponse } from "@/lib/api/cors";
import { rateLimit } from "@/lib/api/rate-limit";
import { getPoolTrades, getTokenHolders } from "@/lib/market-data";

export const runtime = "edge";

export function OPTIONS() {
  return optionsResponse();
}

export async function GET(req: NextRequest) {
  if (!rateLimit(req, "public:market-token-detail", 90).ok) {
    return jsonResponse({ error: "Too many requests." }, { status: 429 });
  }

  const pool = req.nextUrl.searchParams.get("pool") ?? "";
  const token = req.nextUrl.searchParams.get("token") ?? "";

  const [tradesResult, holdersResult] = await Promise.allSettled([
    getPoolTrades(pool, token),
    getTokenHolders(token),
  ]);

  if (tradesResult.status === "rejected") {
    console.error("Failed to fetch pool trades", tradesResult.reason);
  }
  if (holdersResult.status === "rejected") {
    console.error("Failed to fetch token holders", holdersResult.reason);
  }

  return jsonResponse({
    pool,
    token,
    trades: tradesResult.status === "fulfilled" ? tradesResult.value : [],
    holders: holdersResult.status === "fulfilled" ? holdersResult.value : [],
  });
}
