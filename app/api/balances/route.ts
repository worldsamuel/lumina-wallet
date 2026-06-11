import { NextRequest, NextResponse } from "next/server";
import { isAddress, type Address } from "viem";
import { fetchBalances } from "@/lib/balances";

const CACHE_TTL_MS = 5_000;
const STALE_CACHE_TTL_MS = 10 * 60_000;

type CachedBalances = {
  expiresAt: number;
  staleUntil: number;
  data: Awaited<ReturnType<typeof serializeBalances>>;
};

const balanceCache = new Map<string, CachedBalances>();

const BALANCE_CACHE_HEADERS = { "Cache-Control": "private, max-age=5, stale-while-revalidate=10" };
const FRESH_BALANCE_HEADERS = { "Cache-Control": "private, no-store, max-age=0" };

function serializeBalances(balances: Awaited<ReturnType<typeof fetchBalances>>) {
  return balances.map((item) => ({
    ...item,
    balance: item.balance.toString(),
  }));
}

/**
 * Returns World Chain balances for a wallet address.
 */
export async function GET(request: NextRequest) {
  const address = request.nextUrl.searchParams.get("address");
  const refresh = request.nextUrl.searchParams.get("refresh") === "1";

  if (!address || !isAddress(address)) {
    return NextResponse.json({ error: "Invalid wallet address." }, { status: 400 });
  }

  const cacheKey = address.toLowerCase();
  const cached = balanceCache.get(cacheKey);
  if (!refresh && cached && cached.expiresAt > Date.now()) {
    return NextResponse.json({ balances: cached.data, cached: true }, { headers: BALANCE_CACHE_HEADERS });
  }

  try {
    const data = serializeBalances(await fetchBalances(address as Address));
    balanceCache.set(cacheKey, {
      data,
      expiresAt: Date.now() + CACHE_TTL_MS,
      staleUntil: Date.now() + STALE_CACHE_TTL_MS,
    });
    return NextResponse.json({ balances: data, cached: false }, { headers: refresh ? FRESH_BALANCE_HEADERS : BALANCE_CACHE_HEADERS });
  } catch {
    console.warn("[balances] upstream unavailable");
    if (cached && cached.staleUntil > Date.now()) {
      return NextResponse.json(
        {
          balances: cached.data,
          cached: true,
          stale: true,
          warning: "Using the last successful on-chain balance snapshot.",
        },
        { headers: refresh ? FRESH_BALANCE_HEADERS : BALANCE_CACHE_HEADERS },
      );
    }
    return NextResponse.json(
      { error: "Unable to read on-chain balances. Please try again later." },
      { status: 502 },
    );
  }
}
