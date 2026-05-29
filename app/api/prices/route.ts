import { NextResponse } from "next/server";
import { TOKENS } from "@/lib/tokens";
import { getWorldChainMarketCatalog } from "@/lib/market-data";

const CACHE_TTL_MS = 30_000;

export const dynamic = "force-dynamic";

type PriceMeta = {
  source: "worldchain" | "cache" | "fallback";
  changes_24h: Record<string, number | null>;
  last_updated_at: Record<string, number>;
  liquidity_usd: Record<string, number>;
  volume_24h_usd: Record<string, number>;
  markets: unknown[];
};

type PricePayload = Record<string, number | string | PriceMeta> & {
  updated_at: string;
  meta: PriceMeta;
};

let cachedPrices: { expiresAt: number; data: PricePayload } | null = null;
let lastGoodPrices: PricePayload | null = null;

function fallbackPrices(): PricePayload {
  return {
    ...Object.fromEntries(TOKENS.map((token) => [token.symbol, token.priceUsd])),
    updated_at: new Date().toISOString(),
    meta: {
      source: "fallback",
      changes_24h: Object.fromEntries(TOKENS.map((token) => [token.symbol, null])),
      last_updated_at: {},
      liquidity_usd: {},
      volume_24h_usd: {},
      markets: [],
    },
  };
}

/**
 * Returns current World Chain on-chain token prices with a 30-second in-memory cache.
 */
export async function GET() {
  if (cachedPrices && cachedPrices.expiresAt > Date.now()) {
    return NextResponse.json({
      ...cachedPrices.data,
      meta: { ...cachedPrices.data.meta, source: "cache" },
    });
  }

  try {
    const markets = await getWorldChainMarketCatalog();
    if (!markets.length) throw new Error("No GeckoTerminal World Chain markets returned");
    const marketBySymbol = new Map(markets.map((market) => [market.symbol, market]));
    const prices = Object.fromEntries(
      TOKENS.map((token) => [token.symbol, marketBySymbol.get(token.symbol)?.priceUsd ?? token.priceUsd]),
    );
    const changes = Object.fromEntries(
      TOKENS.map((token) => [token.symbol, marketBySymbol.get(token.symbol)?.change24h ?? null]),
    );
    const liquidity = Object.fromEntries(
      TOKENS.map((token) => [token.symbol, marketBySymbol.get(token.symbol)?.liquidityUsd ?? 0]),
    );
    const volume = Object.fromEntries(
      TOKENS.map((token) => [token.symbol, marketBySymbol.get(token.symbol)?.volume24hUsd ?? 0]),
    );

    const data: PricePayload = {
      ...prices,
      updated_at: new Date().toISOString(),
      meta: {
        source: "worldchain",
        changes_24h: changes,
        last_updated_at: {},
        liquidity_usd: liquidity,
        volume_24h_usd: volume,
        markets: TOKENS.map((token) => marketBySymbol.get(token.symbol)).filter(Boolean),
      },
    };

    cachedPrices = { data, expiresAt: Date.now() + CACHE_TTL_MS };
    lastGoodPrices = data;
    return NextResponse.json(data);
  } catch (error) {
    console.error("Failed to fetch CoinGecko prices", error);
    if (lastGoodPrices) {
      return NextResponse.json({
        ...lastGoodPrices,
        updated_at: new Date().toISOString(),
        meta: { ...lastGoodPrices.meta, source: "cache" },
      });
    }

    const data = fallbackPrices();
    cachedPrices = { data, expiresAt: Date.now() + CACHE_TTL_MS };
    return NextResponse.json(data);
  }
}
