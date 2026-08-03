import { NextResponse } from "next/server";
import { readOraclePrices } from "@/lib/oracle";
import type { OnchainPricesResponse } from "@/lib/prices";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const CACHE_TTL_MS = 3_000;
const MARKET_CACHE_HEADERS = {
  "Cache-Control": "public, max-age=2, s-maxage=3, stale-while-revalidate=15",
  "CDN-Cache-Control": "public, s-maxage=3, stale-while-revalidate=15",
  "Vercel-CDN-Cache-Control": "public, s-maxage=3, stale-while-revalidate=15",
};

let cachedOnchain: { expiresAt: number; data: OnchainPricesResponse } | null = null;
let lastGoodOnchain: OnchainPricesResponse | null = null;

export async function GET() {
  if (cachedOnchain && cachedOnchain.expiresAt > Date.now()) {
    return onchainResponse(cachedOnchain.data);
  }

  try {
    const data = await readOraclePrices();
    cachedOnchain = { data, expiresAt: Date.now() + CACHE_TTL_MS };
    lastGoodOnchain = data;
    return onchainResponse(data);
  } catch {
    console.warn("[prices/onchain] upstream unavailable");
    if (lastGoodOnchain) {
      const staleData = { ...lastGoodOnchain, stale: true };
      cachedOnchain = { data: staleData, expiresAt: Date.now() + CACHE_TTL_MS };
      return onchainResponse(staleData);
    }

    return NextResponse.json(
      { error: "Unable to fetch Chainlink oracle prices.", stale: true },
      { status: 502, headers: MARKET_CACHE_HEADERS },
    );
  }
}

function onchainResponse(data: OnchainPricesResponse) {
  return NextResponse.json(data, {
    headers: MARKET_CACHE_HEADERS,
  });
}
