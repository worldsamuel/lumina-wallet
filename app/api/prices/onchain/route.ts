import { NextResponse } from "next/server";
import { readOraclePrices } from "@/lib/oracle";
import type { OnchainPricesResponse } from "@/lib/prices";
import { readSharedCache, writeSharedCache, type SharedCacheEntry } from "@/lib/server/shared-file-cache";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const CACHE_TTL_MS = 30_000;
const STALE_CACHE_TTL_MS = 10 * 60_000;
const SHARED_CACHE_NAMESPACE = "onchain-prices";
const SHARED_CACHE_KEY = "world-chain";
const MARKET_CACHE_HEADERS = {
  "Cache-Control": "public, max-age=15, s-maxage=30, stale-while-revalidate=60",
  "CDN-Cache-Control": "public, s-maxage=30, stale-while-revalidate=60",
  "Vercel-CDN-Cache-Control": "public, s-maxage=30, stale-while-revalidate=60",
};

let cachedOnchain: SharedCacheEntry<OnchainPricesResponse> | null = null;
let lastGoodOnchain: OnchainPricesResponse | null = null;

export async function GET() {
  if (cachedOnchain && cachedOnchain.expiresAt > Date.now()) {
    return onchainResponse(cachedOnchain.data);
  }

  const shared = await readSharedCache<OnchainPricesResponse>(SHARED_CACHE_NAMESPACE, SHARED_CACHE_KEY);
  if (shared && shared.expiresAt > Date.now()) {
    cachedOnchain = shared;
    lastGoodOnchain = shared.data;
    return onchainResponse(shared.data);
  }

  try {
    const data = await readOraclePrices();
    cachedOnchain = cacheEntry(data);
    lastGoodOnchain = data;
    await writeSharedCache(SHARED_CACHE_NAMESPACE, SHARED_CACHE_KEY, cachedOnchain).catch(() => {
      console.warn("[prices/onchain] shared cache write unavailable");
    });
    return onchainResponse(data);
  } catch {
    console.warn("[prices/onchain] upstream unavailable");
    const staleSource = lastGoodOnchain ?? shared?.data ?? null;
    if (staleSource) {
      const staleData = { ...staleSource, stale: true };
      cachedOnchain = cacheEntry(staleData);
      return onchainResponse(staleData);
    }

    return NextResponse.json(
      { error: "Unable to fetch Chainlink oracle prices.", stale: true },
      { status: 502, headers: MARKET_CACHE_HEADERS },
    );
  }
}

function cacheEntry(data: OnchainPricesResponse): SharedCacheEntry<OnchainPricesResponse> {
  return {
    data,
    expiresAt: Date.now() + CACHE_TTL_MS,
    staleUntil: Date.now() + STALE_CACHE_TTL_MS,
  };
}

function onchainResponse(data: OnchainPricesResponse) {
  return NextResponse.json(data, {
    headers: MARKET_CACHE_HEADERS,
  });
}
