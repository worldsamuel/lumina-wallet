import { NextRequest } from "next/server";
import { jsonResponse, optionsResponse } from "@/lib/api/cors";
import { rateLimit } from "@/lib/api/rate-limit";
import { getPoolTrades } from "@/lib/market-data";

export function OPTIONS() {
  return optionsResponse();
}

export async function GET(req: NextRequest) {
  if (!rateLimit(req, "public:market-token-detail", 90).ok) {
    return jsonResponse({ error: "Too many requests." }, { status: 429 });
  }

  const pool = req.nextUrl.searchParams.get("pool") ?? "";
  const token = req.nextUrl.searchParams.get("token") ?? "";
  const tradesResult = await getPoolTrades(pool, token).then(
    (trades) => ({ status: "fulfilled" as const, value: trades }),
    (reason) => ({ status: "rejected" as const, reason }),
  );

  if (tradesResult.status === "rejected") console.warn("[market/token-detail] trades unavailable");

  return jsonResponse({
    pool,
    token,
    trades: tradesResult.status === "fulfilled" ? tradesResult.value : [],
  });
}
