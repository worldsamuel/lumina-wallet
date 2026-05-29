import { NextResponse } from "next/server";
import { TOKENS } from "@/lib/tokens";

const CACHE_TTL_MS = 30_000;
const COINGECKO_URL = "https://api.coingecko.com/api/v3/simple/price";

export const dynamic = "force-dynamic";

type PriceMeta = {
  source: "coingecko" | "cache" | "fallback";
  changes_24h: Record<string, number>;
  last_updated_at: Record<string, number>;
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
      changes_24h: Object.fromEntries(TOKENS.map((token) => [token.symbol, 0])),
      last_updated_at: {},
    },
  };
}

/**
 * Returns current CoinGecko token prices with a 30-second in-memory cache.
 */
export async function GET() {
  if (cachedPrices && cachedPrices.expiresAt > Date.now()) {
    return NextResponse.json({
      ...cachedPrices.data,
      meta: { ...cachedPrices.data.meta, source: "cache" },
    });
  }

  const params = new URLSearchParams({
    ids: TOKENS.map((token) => token.coingeckoId).join(","),
    vs_currencies: "usd",
    include_24hr_change: "true",
    include_last_updated_at: "true",
  });

  try {
    const response = await fetch(`${COINGECKO_URL}?${params}`, {
      headers: { accept: "application/json" },
      next: { revalidate: 30 },
    });
    if (!response.ok) throw new Error(`CoinGecko responded ${response.status}`);

    const body = (await response.json()) as Record<
      string,
      { usd?: number; usd_24h_change?: number; last_updated_at?: number }
    >;

    const prices = Object.fromEntries(
      TOKENS.map((token) => [token.symbol, body[token.coingeckoId]?.usd ?? token.priceUsd]),
    );
    const changes = Object.fromEntries(
      TOKENS.map((token) => [token.symbol, body[token.coingeckoId]?.usd_24h_change ?? 0]),
    );
    const updated = Object.fromEntries(
      TOKENS.map((token) => [token.symbol, body[token.coingeckoId]?.last_updated_at ?? 0]),
    );

    const data: PricePayload = {
      ...prices,
      updated_at: new Date().toISOString(),
      meta: {
        source: "coingecko",
        changes_24h: changes,
        last_updated_at: updated,
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
