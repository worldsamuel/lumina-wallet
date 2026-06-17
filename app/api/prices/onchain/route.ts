import { NextResponse } from "next/server";
import { readOraclePrices } from "@/lib/oracle";
import type { OnchainPricesResponse } from "@/lib/prices";

export const dynamic = "force-dynamic";

const CACHE_TTL_MS = 30_000;
const MARKET_CACHE_CONTROL = "public, max-age=30, s-maxage=30, stale-while-revalidate=30";

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
      { status: 502 },
    );
  }
}

function onchainResponse(data: OnchainPricesResponse) {
  return NextResponse.json(data, {
    headers: { "Cache-Control": MARKET_CACHE_CONTROL },
  });
}
