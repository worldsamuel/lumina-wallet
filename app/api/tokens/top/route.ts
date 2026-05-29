import { NextRequest } from "next/server";
import { jsonResponse, optionsResponse } from "@/lib/api/cors";
import { rateLimit } from "@/lib/api/rate-limit";
import { getWorldChainMarkets } from "@/lib/market-data";

export function OPTIONS() {
  return optionsResponse();
}

export async function GET(req: NextRequest) {
  if (!rateLimit(req, "public:tokens-top", 60).ok) {
    return jsonResponse({ error: "Too many requests." }, { status: 429 });
  }

  const tokens = await getWorldChainMarkets();
  return jsonResponse(tokens);
}
