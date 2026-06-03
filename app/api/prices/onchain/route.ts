import { NextResponse } from "next/server";
import { getWorldChainMarketCatalog } from "@/lib/market-data";
import type { OnchainPricesResponse } from "@/lib/prices";

export const runtime = "edge";
export const dynamic = "force-dynamic";

const CACHE_TTL_MS = 60_000;

let cachedOnchain: { expiresAt: number; data: OnchainPricesResponse } | null = null;
let lastGoodOnchain: OnchainPricesResponse | null = null;

export async function GET() {
  if (cachedOnchain && cachedOnchain.expiresAt > Date.now()) {
    return NextResponse.json(cachedOnchain.data);
  }

  try {
    const catalog = await getWorldChainMarketCatalog();
    const bySymbol = new Map(catalog.map((market) => [market.symbol.toUpperCase(), market]));
    const data: OnchainPricesResponse = {
      WLD: bySymbol.get("WLD")?.priceUsd ?? null,
      USDC: bySymbol.get("USDC")?.priceUsd ?? 1,
      ETH: bySymbol.get("WETH")?.priceUsd ?? bySymbol.get("ETH")?.priceUsd ?? null,
      BTC: bySymbol.get("WBTC")?.priceUsd ?? bySymbol.get("BTC")?.priceUsd ?? null,
      updatedAt: Date.now(),
      stale: false,
    };
    cachedOnchain = { data, expiresAt: Date.now() + CACHE_TTL_MS };
    lastGoodOnchain = data;
    return NextResponse.json(data);
  } catch (error) {
    console.error("Failed to fetch GeckoTerminal prices", error);
    if (lastGoodOnchain) {
      const staleData = { ...lastGoodOnchain, stale: true };
      cachedOnchain = { data: staleData, expiresAt: Date.now() + CACHE_TTL_MS };
      return NextResponse.json(staleData);
    }

    return NextResponse.json(
      { error: "Unable to fetch GeckoTerminal prices.", stale: true },
      { status: 502 },
    );
  }
}
