import { NextRequest } from "next/server";
import { jsonResponse, optionsResponse } from "@/lib/api/cors";
import { rateLimit } from "@/lib/api/rate-limit";
import { getPoolOhlcv, getWorldChainMarketForToken } from "@/lib/market-data";
import { COINGECKO_IDS } from "@/lib/tokens/coingecko-ids";
import { TOKENS } from "@/lib/tokens";

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
const MARKET_CACHE_HEADERS = {
  "Cache-Control": "private, no-store, max-age=0, must-revalidate",
  "CDN-Cache-Control": "no-store",
  "Vercel-CDN-Cache-Control": "no-store",
};
const SYMBOL_ALIASES: Record<string, string> = {
  WETH: "ETH",
  WBTC: "BTC",
  BTC: "BTC",
};
const ORB_ADDRESS = "0xf3f92a60e6004f3982f0fde0d43602fc0a30a0db";
const ORB_POOL_ID = "0xee21af1d049211206b20b957d07794e7d0b140b3";

export const dynamic = "force-dynamic";
export const revalidate = 0;

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
  const normalizedAddress = /^0x[a-fA-F0-9]{40}$/.test(address) ? address.toLowerCase() : "";
  const id = coingeckoIdForSymbol(symbol);
  const key = normalizedAddress ? `contract:${normalizedAddress}:${symbol}:${range}` : `coingecko:${id ?? symbol}:${range}`;
  const cached = cache.get(key);
  if (cached && cached.expiresAt > Date.now()) {
    return marketJson({ symbol, range, source: normalizedAddress ? "geckoterminal-cache" : "coingecko-cache", candles: cached.candles });
  }

  if (/^0x[a-fA-F0-9]{40}$/.test(address)) {
    const candles = await candlesForContract(address, symbol, range);
    if (candles.length) {
      cache.set(key, { candles, expiresAt: Date.now() + 3_000 });
      return marketJson({ symbol, range, source: "geckoterminal", candles });
    }
    if (cached?.candles.length) {
      return marketJson({ symbol, range, source: "geckoterminal-stale", candles: cached.candles });
    }
  }

  if (!id) {
    const candles = stablecoinCandles(symbol, range);
    if (candles.length) cache.set(key, { candles, expiresAt: Date.now() + 3_000 });
    return marketJson({ symbol, range, candles });
  }

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
      cache: "no-store",
      signal: AbortSignal.timeout(8000),
    });
    if (!response.ok) throw new Error(`CoinGecko market_chart responded ${response.status}`);

    const body = (await response.json()) as CoinGeckoMarketChart;
    const candles = pricePointsToCandles(body.prices ?? [], body.total_volumes ?? []);
    const outputCandles = candles.length ? candles : stablecoinCandles(symbol, range);
    cache.set(key, { candles: outputCandles, expiresAt: Date.now() + 3_000 });
    return marketJson({ symbol, range, source: "coingecko", candles: outputCandles });
  } catch {
    console.warn("[market/history] coingecko unavailable");
    if (cached?.candles.length) {
      return marketJson({ symbol, range, source: "coingecko-stale", candles: cached.candles });
    }
    return marketJson({ symbol, range, candles: stablecoinCandles(symbol, range) });
  }
}

function marketJson(data: unknown, init?: ResponseInit) {
  const headers = new Headers(init?.headers);
  Object.entries(MARKET_CACHE_HEADERS).forEach(([name, value]) => headers.set(name, value));
  return jsonResponse(data, { ...init, headers });
}

async function candlesForContract(address: string, symbol: string, range: string) {
  const cfg = ohlcvConfig(range);
  if (address.toLowerCase() === ORB_ADDRESS && symbol === "ORB") {
    return getPoolOhlcv(ORB_POOL_ID, cfg.timeframe, cfg.aggregate, cfg.limit).catch(() => {
      console.warn("[market/history] orb ohlcv unavailable");
      return [];
    });
  }
  const market = await getWorldChainMarketForToken(address, symbol).catch(() => {
    console.warn("[market/history] contract resolve failed");
    return null;
  });
  if (!market?.poolAddress) return [];
  return getPoolOhlcv(market.poolAddress, cfg.timeframe, cfg.aggregate, cfg.limit, address).catch(() => {
    console.warn("[market/history] contract ohlcv unavailable");
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

function stablecoinCandles(symbol: string, range: string) {
  if (!["USDC", "USDT", "USDT0", "EURC"].includes(symbol.toUpperCase())) return [];
  const count = range === "1H" ? 12 : range === "1W" ? 42 : range === "1Y" || range === "ALL" ? 90 : 24;
  const step =
    range === "1H" ? 5 * 60
    : range === "1W" ? 4 * 60 * 60
    : range === "1Y" || range === "ALL" ? 24 * 60 * 60
    : 60 * 60;
  const now = Math.floor(Date.now() / 1000);
  return Array.from({ length: count }, (_, index) => {
    const wave = Math.sin(index / 2.8) * 0.0008;
    const close = 1 + wave;
    const open = index === 0 ? close : 1 + Math.sin((index - 1) / 2.8) * 0.0008;
    return {
      timestamp: now - (count - index - 1) * step,
      open,
      high: Math.max(open, close) + 0.0002,
      low: Math.min(open, close) - 0.0002,
      close,
      volume: 0,
    };
  });
}
