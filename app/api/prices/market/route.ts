import { type MarketPrice, type MarketPricesResponse, PRICE_SYMBOLS } from "@/lib/prices";
import { getWorldChainMarketCatalog } from "@/lib/market-data";

export const runtime = "edge";

const CACHE_TTL_MS = 30_000;

let cachedMarket: { expiresAt: number; data: MarketPricesResponse } | null = null;
let lastGoodMarket: MarketPricesResponse | null = null;

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

function marketResponse(data: MarketPricesResponse) {
  return new Response(JSON.stringify(data), {
    headers: {
      "Cache-Control": "public, s-maxage=30, stale-while-revalidate=60",
      "Content-Type": "application/json",
    },
  });
}

export async function GET() {
  if (cachedMarket && cachedMarket.expiresAt > Date.now()) {
    return marketResponse(cachedMarket.data);
  }

  try {
    const catalog = await getWorldChainMarketCatalog();
    const bySymbol = new Map(catalog.map((market) => [market.symbol.toUpperCase(), market]));
    const aliases: Record<(typeof PRICE_SYMBOLS)[number], string[]> = {
      WLD: ["WLD"],
      USDC: ["USDC"],
      ETH: ["WETH", "ETH"],
      BTC: ["WBTC", "BTC"],
    };
    const data = {
      updated_at: new Date().toISOString(),
      stale: false,
    } as MarketPricesResponse;

    PRICE_SYMBOLS.forEach((symbol) => {
      const market = aliases[symbol].map((alias) => bySymbol.get(alias)).find(Boolean);
      data[symbol] = {
        ...emptyMarketPrice(),
        usd: market?.priceUsd ?? (symbol === "USDC" ? 1 : null),
        usd_24h_change: market?.change24h ?? null,
        usd_market_cap: market?.liquidityUsd ?? null,
      };
    });

    cachedMarket = { data, expiresAt: Date.now() + CACHE_TTL_MS };
    lastGoodMarket = data;
    return marketResponse(data);
  } catch (error) {
    console.error("Failed to fetch GeckoTerminal market prices", error);
    if (lastGoodMarket) {
      const staleData = { ...lastGoodMarket, stale: true, updated_at: new Date().toISOString() };
      cachedMarket = { data: staleData, expiresAt: Date.now() + CACHE_TTL_MS };
      return marketResponse(staleData);
    }

    return Response.json({ error: "Unable to fetch GeckoTerminal market prices.", stale: true }, { status: 502 });
  }
}
