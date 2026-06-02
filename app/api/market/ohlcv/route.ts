import { NextRequest } from "next/server";
import { jsonResponse, optionsResponse } from "@/lib/api/cors";
import { rateLimit } from "@/lib/api/rate-limit";
import { getPoolOhlcv } from "@/lib/market-data";

export const runtime = "edge";

export function OPTIONS() {
  return optionsResponse();
}

export async function GET(req: NextRequest) {
  if (!rateLimit(req, "public:market-ohlcv", 120).ok) {
    return jsonResponse({ error: "Too many requests." }, { status: 429 });
  }

  const url = new URL(req.url);
  const pool = url.searchParams.get("pool") ?? "";
  const range = (url.searchParams.get("range") ?? "1D").toUpperCase();
  const configs =
    range === "1H"
      ? [{ timeframe: "minute", aggregate: "5", limit: "12" }]
      : range === "1D"
        ? [{ timeframe: "hour", aggregate: "1", limit: "24" }]
        : range === "1W"
          ? [{ timeframe: "hour", aggregate: "4", limit: "42" }]
          : range === "1M"
            ? [{ timeframe: "day", aggregate: "1", limit: "30" }]
          : range === "1Y"
            ? [
                { timeframe: "day", aggregate: "1", limit: "365" },
                { timeframe: "day", aggregate: "7", limit: "52" },
                { timeframe: "day", aggregate: "1", limit: "180" },
              ]
            : range === "ALL"
              ? [
                  { timeframe: "day", aggregate: "7", limit: "260" },
                  { timeframe: "day", aggregate: "1", limit: "365" },
                ]
            : [{ timeframe: "hour", aggregate: "1", limit: "24" }];

  try {
    for (const config of configs) {
      const candles = await getPoolOhlcv(pool, config.timeframe, config.aggregate, config.limit);
      if (candles.length) return jsonResponse({ pool, range, candles });
    }
    return jsonResponse({ pool, range, candles: [] });
  } catch (error) {
    console.error("Failed to fetch GeckoTerminal OHLCV", error);
    return jsonResponse({ pool, range, candles: [] });
  }
}
