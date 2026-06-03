import { NextRequest } from "next/server";
import { jsonResponse, optionsResponse } from "@/lib/api/cors";
import { rateLimit } from "@/lib/api/rate-limit";
import { getPoolOhlcv, getWorldChainMarketCatalog } from "@/lib/market-data";

export const runtime = "edge";

type HistoryConfig = {
  timeframe: "minute" | "hour" | "day";
  aggregate: string;
  limit: string;
};

export function OPTIONS() {
  return optionsResponse();
}

export async function GET(req: NextRequest) {
  if (!rateLimit(req, "public:market-history", 120).ok) {
    return jsonResponse({ error: "Too many requests." }, { status: 429 });
  }

  const symbol = (req.nextUrl.searchParams.get("symbol") ?? "").toUpperCase();
  const range = (req.nextUrl.searchParams.get("range") ?? "1D").toUpperCase();
  if (!symbol) return jsonResponse({ symbol, range, source: "geckoterminal", candles: [] });

  try {
    const market = (await getWorldChainMarketCatalog()).find((item) => {
      const itemSymbol = item.symbol.toUpperCase();
      if (itemSymbol === symbol) return true;
      if (symbol === "ETH" && itemSymbol === "WETH") return true;
      if (symbol === "BTC" && itemSymbol === "WBTC") return true;
      return false;
    });
    if (!market?.poolAddress) return jsonResponse({ symbol, range, source: "geckoterminal", candles: [] });

    for (const config of historyConfigs(range)) {
      const candles = await getPoolOhlcv(market.poolAddress, config.timeframe, config.aggregate, config.limit);
      if (candles.length) return jsonResponse({ symbol, range, source: "geckoterminal", pool: market.poolAddress, candles });
    }

    return jsonResponse({ symbol, range, source: "geckoterminal", pool: market.poolAddress, candles: [] });
  } catch (error) {
    console.error("Failed to fetch GeckoTerminal market history", error);
    return jsonResponse({ symbol, range, source: "geckoterminal", candles: [] });
  }
}

function historyConfigs(range: string): HistoryConfig[] {
  if (range === "1H") return [{ timeframe: "minute", aggregate: "5", limit: "12" }];
  if (range === "1W") return [{ timeframe: "hour", aggregate: "4", limit: "42" }];
  if (range === "1Y") {
    return [
      { timeframe: "day", aggregate: "1", limit: "365" },
      { timeframe: "day", aggregate: "7", limit: "52" },
      { timeframe: "day", aggregate: "1", limit: "180" },
    ];
  }
  if (range === "ALL") {
    return [
      { timeframe: "day", aggregate: "7", limit: "260" },
      { timeframe: "day", aggregate: "1", limit: "365" },
    ];
  }
  return [{ timeframe: "hour", aggregate: "1", limit: "24" }];
}
