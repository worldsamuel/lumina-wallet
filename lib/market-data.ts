import type { Address } from "viem";
import { TOKENS } from "./tokens";

const GECKO_NETWORK = "world-chain";
const GECKO_POOLS_URL = `https://api.geckoterminal.com/api/v2/networks/${GECKO_NETWORK}/pools`;
const GECKO_OHLCV_URL = `https://api.geckoterminal.com/api/v2/networks/${GECKO_NETWORK}/pools`;
const CACHE_TTL_MS = 30_000;
const MIN_LIQUIDITY_USD = 100;
const MIN_VOLUME_24H_USD = 1;
const EXCLUDED_TOP_SYMBOLS = new Set(["USDC", "USDT", "DAI", "USDCE", "ETH", "WETH", "WBTC"]);
const STABLE_SYMBOLS = new Set(["USDC", "USDT", "DAI", "USDCE"]);
const KNOWN_TOKEN_ADDRESSES = new Map(
  TOKENS.flatMap((token) => {
    if (token.contractAddress) return [[token.contractAddress.toLowerCase(), token.symbol] as const];
    if (token.symbol === "ETH") return [["0x4200000000000000000000000000000000000006", token.symbol] as const];
    return [];
  }),
);

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

type GeckoOhlcvResponse = {
  data?: {
    attributes?: {
      ohlcv_list?: Array<[number, number, number, number, number, number]>;
    };
  };
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

function symbolOverride(address: string, fallback: string) {
  return KNOWN_TOKEN_ADDRESSES.get(address.toLowerCase()) ?? fallback.toUpperCase();
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

type PoolSide = {
  token: GeckoToken | undefined;
  address: string;
  priceUsd: number;
  change24h: number | null;
};

function sideFromPool(pool: GeckoPool, byAddress: Map<string, GeckoToken>, side: "base" | "quote"): PoolSide | null {
  const id =
    side === "base"
      ? pool.relationships?.base_token?.data?.id
      : pool.relationships?.quote_token?.data?.id;
  const address = tokenAddressFromId(id);
  if (!address) return null;
  const token = byAddress.get(address.toLowerCase());
  const priceUsd = num(
    side === "base" ? pool.attributes?.base_token_price_usd : pool.attributes?.quote_token_price_usd,
  );
  if (!priceUsd) return null;

  const baseId = pool.relationships?.base_token?.data?.id;
  const baseAddress = tokenAddressFromId(baseId);
  const base = byAddress.get(baseAddress.toLowerCase());
  const baseSymbol = String(base?.attributes?.symbol ?? "").toUpperCase();
  const rawChange = num(pool.attributes?.price_change_percentage?.h24);
  const change24h =
    STABLE_SYMBOLS.has(String(token?.attributes?.symbol ?? "").toUpperCase())
      ? null
      : side === "quote" && STABLE_SYMBOLS.has(baseSymbol)
        ? -rawChange
        : rawChange;

  return { token, address, priceUsd, change24h };
}

/**
 * Reads GeckoTerminal World Chain pool data and derives token-level market data.
 */
export async function getWorldChainMarketCatalog() {
  if (cached && cached.expiresAt > Date.now()) return cached.data;

  try {
    const settledPages = await Promise.allSettled([1, 2, 3, 4, 5].map(fetchGeckoPage));
    const pages = settledPages
      .filter((result): result is PromiseFulfilledResult<GeckoResponse> => result.status === "fulfilled")
      .map((result) => result.value);
    if (!pages.length) {
      settledPages.forEach((result) => {
        if (result.status === "rejected") console.error(result.reason);
      });
      throw new Error("No GeckoTerminal World Chain pages returned");
    }
    const byAddress = new Map<string, GeckoToken>();
    for (const page of pages) {
      for (const token of page.included ?? []) {
        const key = tokenKey(token);
        if (key) byAddress.set(key, token);
      }
    }

    const best = new Map<string, MarketToken>();
    for (const pool of pages.flatMap((page) => page.data ?? [])) {
      const volume24hUsd = num(pool.attributes?.volume_usd?.h24);
      const liquidityUsd = num(pool.attributes?.reserve_in_usd);
      if (liquidityUsd < MIN_LIQUIDITY_USD || volume24hUsd < MIN_VOLUME_24H_USD) continue;

      for (const side of ["base", "quote"] as const) {
        const marketSide = sideFromPool(pool, byAddress, side);
        if (!marketSide) continue;

        const rawSymbol = String(marketSide.token?.attributes?.symbol ?? "").toUpperCase();
        const symbol = symbolOverride(marketSide.address, rawSymbol);
        if (!symbol) continue;

        const current = best.get(symbol);
        if (current && current.liquidityUsd >= liquidityUsd) continue;

        best.set(symbol, {
          symbol,
          name: marketSide.token?.attributes?.name ?? TOKENS.find((token) => token.symbol === symbol)?.name ?? symbol,
          address: formatAddress(marketSide.token?.attributes?.address ?? marketSide.address),
          priceUsd: marketSide.priceUsd,
          change24h: marketSide.change24h,
          volume24hUsd,
          liquidityUsd,
          logoUrl: marketSide.token?.attributes?.image_url ?? null,
          poolAddress: pool.attributes?.address ?? pool.id,
          verified: verifiedBySymbol(symbol),
        });
      }
    }

    const data = [...best.values()].sort((a, b) => b.liquidityUsd - a.liquidityUsd);
    cached = { data, expiresAt: Date.now() + CACHE_TTL_MS };
    lastGood = data;
    return data;
  } catch (error) {
    console.error("Failed to fetch World Chain market data", error);
    return lastGood;
  }
}

/**
 * Returns the top 24h gainers from GeckoTerminal World Chain pools.
 */
export async function getWorldChainMarkets() {
  const catalog = await getWorldChainMarketCatalog();
  return catalog
    .filter((market) => !EXCLUDED_TOP_SYMBOLS.has(market.symbol))
    .filter((market) => market.change24h !== null && Number.isFinite(Number(market.change24h)))
    .sort((a, b) => (b.change24h ?? 0) - (a.change24h ?? 0))
    .slice(0, 10);
}

export async function getPoolOhlcv(poolAddress: string, timeframe = "day", aggregate = "1", limit = "60") {
  if (!/^0x[a-fA-F0-9]{40}$/.test(poolAddress)) return [];
  const safeTimeframe = ["minute", "hour", "day"].includes(timeframe) ? timeframe : "day";
  const params = new URLSearchParams({
    aggregate: String(Math.max(1, Math.min(30, Number.parseInt(aggregate, 10) || 1))),
    limit: String(Math.max(10, Math.min(200, Number.parseInt(limit, 10) || 60))),
    currency: "usd",
  });
  const response = await fetch(`${GECKO_OHLCV_URL}/${poolAddress}/ohlcv/${safeTimeframe}?${params}`, {
    headers: { accept: "application/json" },
    next: { revalidate: 30 },
  });
  if (!response.ok) throw new Error(`GeckoTerminal OHLCV responded ${response.status}`);
  const body = (await response.json()) as GeckoOhlcvResponse;
  return (body.data?.attributes?.ohlcv_list ?? []).map(([timestamp, open, high, low, close, volume]) => ({
    timestamp,
    open,
    high,
    low,
    close,
    volume,
  }));
}
