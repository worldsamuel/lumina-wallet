import { NextRequest, NextResponse } from "next/server";
import { isAddress, type Address } from "viem";
import { rateLimit } from "@/lib/api/rate-limit";
import { fetchBalances } from "@/lib/balances";
import { readSharedCache, writeSharedCache, type SharedCacheEntry } from "@/lib/server/shared-file-cache";

const CACHE_TTL_MS = 30_000;
const STALE_CACHE_TTL_MS = 10 * 60_000;

type CachedBalances = SharedCacheEntry<Awaited<ReturnType<typeof serializeBalances>>>;

const balanceCache = new Map<string, CachedBalances>();
const pendingBalanceReads = new Map<string, Promise<CachedBalances["data"]>>();
const SHARED_CACHE_NAMESPACE = "wallet-balances";

const BALANCE_CACHE_HEADERS = {
  "Cache-Control": "private, max-age=30, stale-while-revalidate=60",
  "CDN-Cache-Control": "no-store",
  "Vercel-CDN-Cache-Control": "no-store",
};
const FRESH_BALANCE_HEADERS = {
  ...BALANCE_CACHE_HEADERS,
  "Cache-Control": "private, no-store, max-age=0, must-revalidate",
};

export const dynamic = "force-dynamic";
export const revalidate = 0;

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
  if (!rateLimit(request, "public:balances", 120).ok) {
    return NextResponse.json({ error: "Too many requests." }, { status: 429, headers: FRESH_BALANCE_HEADERS });
  }
  const address = request.nextUrl.searchParams.get("address");
  const refresh = request.nextUrl.searchParams.get("refresh") === "1";

  if (!address || !isAddress(address)) {
    return NextResponse.json({ error: "Invalid wallet address." }, { status: 400 });
  }

  const cacheKey = address.toLowerCase();
  let cached = balanceCache.get(cacheKey);
  if (!refresh && cached && cached.expiresAt > Date.now()) {
    return NextResponse.json({ balances: cached.data, cached: true }, { headers: BALANCE_CACHE_HEADERS });
  }
  if (!refresh) {
    const shared = await readSharedCache<CachedBalances["data"]>(SHARED_CACHE_NAMESPACE, cacheKey);
    if (shared) {
      cached = shared;
      balanceCache.set(cacheKey, shared);
      if (shared.expiresAt > Date.now()) {
        return NextResponse.json({ balances: shared.data, cached: true }, { headers: BALANCE_CACHE_HEADERS });
      }
    }
  }

  try {
    const data = refresh
      ? await readFreshBalances(cacheKey, address as Address)
      : await readBalancesOnce(cacheKey, address as Address);
    const entry: CachedBalances = {
      data,
      expiresAt: Date.now() + CACHE_TTL_MS,
      staleUntil: Date.now() + STALE_CACHE_TTL_MS,
    };
    balanceCache.set(cacheKey, entry);
    await writeSharedCache(SHARED_CACHE_NAMESPACE, cacheKey, entry).catch(() => {
      console.warn("[balances] shared cache write unavailable");
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
      { status: 502, headers: BALANCE_CACHE_HEADERS },
    );
  }
}

async function readFreshBalances(cacheKey: string, address: Address) {
  pendingBalanceReads.delete(cacheKey);
  return serializeBalances(await fetchBalances(address));
}

async function readBalancesOnce(cacheKey: string, address: Address) {
  const pending = pendingBalanceReads.get(cacheKey);
  if (pending) return pending;
  const next = fetchBalances(address)
    .then(serializeBalances)
    .finally(() => pendingBalanceReads.delete(cacheKey));
  pendingBalanceReads.set(cacheKey, next);
  return next;
}
