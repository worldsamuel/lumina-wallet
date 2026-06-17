import { NextResponse } from "next/server";
import { COINGECKO_IDS } from "@/lib/tokens/coingecko-ids";
import { type MarketPrice, type MarketPricesResponse, PRICE_SYMBOLS } from "@/lib/prices";

export const dynamic = "force-dynamic";

const CACHE_TTL_MS = 30_000;
const MARKET_CACHE_CONTROL = "public, max-age=30, s-maxage=30, stale-while-revalidate=30";
const COINGECKO_SIMPLE_PRICE_URL = "https://api.coingecko.com/api/v3/simple/price";
const VS_CURRENCIES = ["usd", "eur", "jpy", "cny", "hkd", "gbp"] as const;

let cachedMarket: { expiresAt: number; data: MarketPricesResponse } | null = null;
let lastGoodMarket: MarketPricesResponse | null = null;

type CoinGeckoSimplePrice = Record<
  string,
  Partial<Record<(typeof VS_CURRENCIES)[number], number>> & {
    usd_24h_change?: number;
    usd_market_cap?: number;
  }
>;

function emptyMarketPrice(): MarketPrice {
  return {
    usd: null,
    eur: null,
    jpy: null,
    cny: null,
    hkd: null,
    gbp: null,
    usd_24h_change: null,
    usd_market_cap: null,
  };
}

function num(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

async function fetchCoinGeckoMarket(): Promise<MarketPricesResponse> {
  const params = new URLSearchParams({
    ids: PRICE_SYMBOLS.map((symbol) => COINGECKO_IDS[symbol]).join(","),
    vs_currencies: VS_CURRENCIES.join(","),
    include_24hr_change: "true",
    include_market_cap: "true",
  });

  const headers: HeadersInit = { accept: "application/json" };
  if (process.env.COINGECKO_DEMO_API_KEY) {
    headers["x-cg-demo-api-key"] = process.env.COINGECKO_DEMO_API_KEY;
  }

  const response = await fetch(`${COINGECKO_SIMPLE_PRICE_URL}?${params}`, {
    headers,
    next: { revalidate: 30 },
  });
  if (!response.ok) throw new Error(`CoinGecko simple/price responded ${response.status}`);

  const raw = (await response.json()) as CoinGeckoSimplePrice;
  const data = {
    updated_at: new Date().toISOString(),
    stale: false,
  } as MarketPricesResponse;

  PRICE_SYMBOLS.forEach((symbol) => {
    const row = raw[COINGECKO_IDS[symbol]] ?? {};
    data[symbol] = {
      ...emptyMarketPrice(),
      usd: num(row.usd),
      eur: num(row.eur),
      jpy: num(row.jpy),
      cny: num(row.cny),
      hkd: num(row.hkd),
      gbp: num(row.gbp),
      usd_24h_change: num(row.usd_24h_change),
      usd_market_cap: num(row.usd_market_cap),
    };
  });

  return data;
}

function marketResponse(data: MarketPricesResponse) {
  return new Response(JSON.stringify(data), {
    headers: {
      "Cache-Control": MARKET_CACHE_CONTROL,
      "Content-Type": "application/json",
    },
  });
}

export async function GET() {
  if (cachedMarket && cachedMarket.expiresAt > Date.now()) {
    return marketResponse(cachedMarket.data);
  }

  try {
    const data = await fetchCoinGeckoMarket();
    cachedMarket = { data, expiresAt: Date.now() + CACHE_TTL_MS };
    lastGoodMarket = data;
    return marketResponse(data);
  } catch {
    console.warn("[prices/market] upstream unavailable");
    if (lastGoodMarket) {
      const staleData = { ...lastGoodMarket, stale: true, updated_at: new Date().toISOString() };
      cachedMarket = { data: staleData, expiresAt: Date.now() + CACHE_TTL_MS };
      return marketResponse(staleData);
    }

    return NextResponse.json(
      { error: "Unable to fetch CoinGecko market prices.", stale: true },
      { status: 502 },
    );
  }
}
