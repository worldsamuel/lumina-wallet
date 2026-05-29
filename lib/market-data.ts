import type { Address } from "viem";
import { TOKENS } from "./tokens";

const GECKO_NETWORK = "world-chain";
const GECKO_POOLS_URL = `https://api.geckoterminal.com/api/v2/networks/${GECKO_NETWORK}/pools`;
const CACHE_TTL_MS = 30_000;
const MIN_LIQUIDITY_USD = 100;
const MIN_VOLUME_24H_USD = 1;
const EXCLUDED_TOP_SYMBOLS = new Set(["USDC", "USDT", "DAI", "USDCE", "ETH", "WETH", "WBTC"]);

type GeckoPool = {
  id: string;
  attributes?: {
    address?: string;
    name?: string;
    base_token_price_usd?: string;
    quote_token_price_usd?: string;
    reserve_in_usd?: string;
    volume_usd?: { h24?: string };
    price_change_percentage?: { h24?: string };
  };
  relationships?: {
    base_token?: { data?: { id?: string } };
    quote_token?: { data?: { id?: string } };
  };
};

type GeckoToken = {
  id: string;
  attributes?: {
    address?: string;
    name?: string;
    symbol?: string;
    image_url?: string;
  };
};

type GeckoResponse = {
  data?: GeckoPool[];
  included?: GeckoToken[];
};

export type MarketToken = {
  symbol: string;
  name: string;
  address: Address | null;
  priceUsd: number | null;
  change24h: number | null;
  volume24hUsd: number;
  liquidityUsd: number;
  logoUrl: string | null;
  poolAddress: string;
  verified: boolean;
};

let cached: { expiresAt: number; data: MarketToken[] } | null = null;
let lastGood: MarketToken[] = [];

function num(value: unknown) {
  const parsed = Number.parseFloat(String(value ?? ""));
  return Number.isFinite(parsed) ? parsed : 0;
}

function tokenAddressFromId(id?: string) {
  const value = String(id ?? "");
  const address = value.split("_").pop();
  return address?.startsWith("0x") ? address : "";
}

function tokenKey(token?: GeckoToken) {
  return tokenAddressFromId(token?.id).toLowerCase();
}

function verifiedBySymbol(symbol: string) {
  return TOKENS.some((token) => token.symbol.toUpperCase() === symbol.toUpperCase());
}

function formatAddress(value: string): Address | null {
  return /^0x[a-fA-F0-9]{40}$/.test(value) ? (value as Address) : null;
}

async function fetchGeckoPage(page: number) {
  const params = new URLSearchParams({
    include: "base_token,quote_token",
    page: String(page),
    sort: "h24_volume_usd_desc",
  });
  const response = await fetch(`${GECKO_POOLS_URL}?${params}`, {
    headers: { accept: "application/json" },
    next: { revalidate: 30 },
  });
  if (!response.ok) throw new Error(`GeckoTerminal responded ${response.status}`);
  return (await response.json()) as GeckoResponse;
}

/**
 * Reads World Chain pool data and derives a token-level 24h gainer list.
 */
export async function getWorldChainMarkets() {
  if (cached && cached.expiresAt > Date.now()) return cached.data;

  try {
    const pages = await Promise.all([1, 2, 3].map(fetchGeckoPage));
    const byAddress = new Map<string, GeckoToken>();
    for (const page of pages) {
      for (const token of page.included ?? []) {
        const key = tokenKey(token);
        if (key) byAddress.set(key, token);
      }
    }

    const best = new Map<string, MarketToken>();
    for (const pool of pages.flatMap((page) => page.data ?? [])) {
      const baseAddress = tokenAddressFromId(pool.relationships?.base_token?.data?.id);
      const base = byAddress.get(baseAddress.toLowerCase());
      const symbol = String(base?.attributes?.symbol ?? "").toUpperCase();
      if (!symbol || EXCLUDED_TOP_SYMBOLS.has(symbol)) continue;

      const priceUsd = num(pool.attributes?.base_token_price_usd);
      const change24h = num(pool.attributes?.price_change_percentage?.h24);
      const volume24hUsd = num(pool.attributes?.volume_usd?.h24);
      const liquidityUsd = num(pool.attributes?.reserve_in_usd);
      if (!priceUsd || !Number.isFinite(change24h)) continue;
      if (liquidityUsd < MIN_LIQUIDITY_USD || volume24hUsd < MIN_VOLUME_24H_USD) continue;

      const current = best.get(symbol);
      if (current && current.liquidityUsd >= liquidityUsd) continue;

      best.set(symbol, {
        symbol,
        name: base?.attributes?.name ?? symbol,
        address: formatAddress(base?.attributes?.address ?? baseAddress),
        priceUsd,
        change24h,
        volume24hUsd,
        liquidityUsd,
        logoUrl: base?.attributes?.image_url ?? null,
        poolAddress: pool.attributes?.address ?? pool.id,
        verified: verifiedBySymbol(symbol),
      });
    }

    const data = [...best.values()].sort((a, b) => (b.change24h ?? 0) - (a.change24h ?? 0)).slice(0, 10);
    cached = { data, expiresAt: Date.now() + CACHE_TTL_MS };
    lastGood = data;
    return data;
  } catch (error) {
    console.error("Failed to fetch World Chain market data", error);
    return lastGood;
  }
}
