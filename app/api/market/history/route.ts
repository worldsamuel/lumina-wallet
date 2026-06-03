import { NextRequest } from "next/server";
import { jsonResponse, optionsResponse } from "@/lib/api/cors";
import { rateLimit } from "@/lib/api/rate-limit";
import { getPoolOhlcv, getWorldChainMarketForToken } from "@/lib/market-data";
import { COINGECKO_IDS } from "@/lib/tokens/coingecko-ids";
import { TOKENS } from "@/lib/tokens";

export const runtime = "edge";

const COINGECKO_MARKET_CHART_URL = "https://api.coingecko.com/api/v3/coins";

type CoinGeckoMarketChart = {
  prices?: Array<[number, number]>;
  total_volumes?: Array<[number, number]>;
};

type HistoryCandle = {
  timestamp: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
};

const cache = new Map<string, { expiresAt: number; candles: HistoryCandle[] }>();
const SYMBOL_ALIASES: Record<string, string> = {
  WETH: "ETH",
  WBTC: "BTC",
  BTC: "BTC",
};

export function OPTIONS() {
  return optionsResponse();
}

export async function GET(req: NextRequest) {
  if (!rateLimit(req, "public:market-history", 120).ok) {
    return jsonResponse({ error: "Too many requests." }, { status: 429 });
  }

  const symbol = (req.nextUrl.searchParams.get("symbol") ?? "").toUpperCase();
  const address = req.nextUrl.searchParams.get("address") ?? "";
  const range = (req.nextUrl.searchParams.get("range") ?? "1D").toUpperCase();
  if (/^0x[a-fA-F0-9]{40}$/.test(address)) {
    const candles = await candlesForContract(address, symbol, range);
    if (candles.length) return jsonResponse({ symbol, range, source: "geckoterminal", candles });
  }

  const id = coingeckoIdForSymbol(symbol);
  if (!id) return jsonResponse({ symbol, range, candles: [] });

  const key = `${id}:${range}`;
  const cached = cache.get(key);
  if (cached && cached.expiresAt > Date.now()) return jsonResponse({ symbol, range, source: "coingecko", candles: cached.candles });

  try {
    const { days, interval } = chartConfig(range);
    const params = new URLSearchParams({
      vs_currency: "usd",
      days,
      interval,
    });
    const headers: HeadersInit = { accept: "application/json" };
    if (process.env.COINGECKO_DEMO_API_KEY) headers["x-cg-demo-api-key"] = process.env.COINGECKO_DEMO_API_KEY;

    const response = await fetch(`${COINGECKO_MARKET_CHART_URL}/${id}/market_chart?${params}`, {
      headers,
      next: { revalidate: 180 },
      signal: AbortSignal.timeout(8000),
    });
    if (!response.ok) throw new Error(`CoinGecko market_chart responded ${response.status}`);

    const body = (await response.json()) as CoinGeckoMarketChart;
    const candles = pricePointsToCandles(body.prices ?? [], body.total_volumes ?? []);
    cache.set(key, { candles, expiresAt: Date.now() + 180_000 });
    return jsonResponse({ symbol, range, source: "coingecko", candles });
  } catch (error) {
    console.error("Failed to fetch CoinGecko market history", error);
    return jsonResponse({ symbol, range, candles: [] });
  }
}

async function candlesForContract(address: string, symbol: string, range: string) {
  const market = await getWorldChainMarketForToken(address, symbol).catch((error) => {
    console.error("Failed to resolve market history contract", error);
    return null;
  });
  if (!market?.poolAddress) return [];
  const cfg = ohlcvConfig(range);
  return getPoolOhlcv(market.poolAddress, cfg.timeframe, cfg.aggregate, cfg.limit).catch((error) => {
    console.error("Failed to fetch contract OHLCV", error);
    return [];
  });
}

function coingeckoIdForSymbol(symbol: string) {
  const normalized = SYMBOL_ALIASES[symbol] ?? symbol;
  const token = TOKENS.find((item) => item.symbol.toUpperCase() === symbol || item.symbol.toUpperCase() === normalized);
  return token?.coingeckoId ?? COINGECKO_IDS[normalized as keyof typeof COINGECKO_IDS] ?? COINGECKO_IDS[symbol as keyof typeof COINGECKO_IDS] ?? null;
}

function chartConfig(range: string) {
  if (range === "1H") return { days: "1", interval: "hourly" };
  if (range === "1W") return { days: "7", interval: "hourly" };
  if (range === "1Y") return { days: "365", interval: "daily" };
  if (range === "ALL") return { days: "max", interval: "daily" };
  return { days: "1", interval: "hourly" };
}

function ohlcvConfig(range: string) {
  if (range === "1H") return { timeframe: "minute", aggregate: "5", limit: "24" };
  if (range === "1W") return { timeframe: "hour", aggregate: "4", limit: "42" };
  if (range === "1Y") return { timeframe: "day", aggregate: "1", limit: "365" };
  if (range === "ALL") return { timeframe: "day", aggregate: "1", limit: "365" };
  return { timeframe: "hour", aggregate: "1", limit: "24" };
}

function pricePointsToCandles(prices: Array<[number, number]>, volumes: Array<[number, number]>) {
  const volumeByTime = new Map(volumes.map(([timestamp, volume]) => [timestamp, volume]));
  return prices
    .filter((point): point is [number, number] => Array.isArray(point) && Number.isFinite(point[0]) && Number.isFinite(point[1]) && point[1] > 0)
    .map(([timestamp, close], index, list) => {
      const previous = index > 0 ? list[index - 1][1] : close;
      return {
        timestamp: Math.floor(timestamp / 1000),
        open: previous,
        high: Math.max(previous, close),
        low: Math.min(previous, close),
        close,
        volume: volumeByTime.get(timestamp) ?? 0,
      };
    });
}
