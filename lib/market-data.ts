import type { Address } from "viem";
import { TOKENS } from "./tokens";

const GECKO_NETWORK = "world-chain";
const GECKO_POOLS_URL = `https://api.geckoterminal.com/api/v2/networks/${GECKO_NETWORK}/pools`;
const GECKO_OHLCV_URL = `https://api.geckoterminal.com/api/v2/networks/${GECKO_NETWORK}/pools`;
const GECKO_TOKENS_URL = `https://api.geckoterminal.com/api/v2/networks/${GECKO_NETWORK}/tokens`;
const WORLDSCAN_API_URL = "https://worldscan.org/api/v2";
const CACHE_TTL_MS = 30_000;
const MIN_LIQUIDITY_USD = 10;
const MIN_VOLUME_24H_USD = 10;
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

type GeckoTradesResponse = {
  data?: Array<{
    id?: string;
    attributes?: Record<string, unknown>;
  }>;
};

type WorldscanHoldersResponse = {
  items?: Array<{
    value?: string;
    address_hash?: {
      hash?: string;
      name?: string | null;
      is_contract?: boolean;
    };
  }>;
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
  decimals: number | null;
};

export type PoolTrade = {
  hash: string | null;
  side: "buy" | "sell";
  timestamp: string | null;
  amount: string | null;
  amountUsd: number | null;
  priceUsd: number | null;
  maker: string | null;
};

export type TokenHolder = {
  address: string;
  label: string | null;
  balance: string;
  isContract: boolean;
};

let cached: { expiresAt: number; data: MarketToken[] } | null = null;
let lastGood: MarketToken[] = [];
const tokenMarketCache = new Map<string, { expiresAt: number; data: MarketToken | null }>();
const ohlcvCache = new Map<
  string,
  {
    expiresAt: number;
    data: Array<{ timestamp: number; open: number; high: number; low: number; close: number; volume: number }>;
  }
>();

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

async function fetchTokenPools(tokenAddress: string) {
  const params = new URLSearchParams({
    include: "base_token,quote_token",
    page: "1",
    sort: "h24_volume_usd_desc",
  });
  const response = await fetch(`${GECKO_TOKENS_URL}/${tokenAddress}/pools?${params}`, {
    headers: { accept: "application/json" },
    next: { revalidate: 60 },
    signal: AbortSignal.timeout(7000),
  });
  if (!response.ok) throw new Error(`GeckoTerminal token pools responded ${response.status}`);
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

function marketFromPoolSide(pool: GeckoPool, marketSide: PoolSide): MarketToken | null {
  const volume24hUsd = num(pool.attributes?.volume_usd?.h24);
  const liquidityUsd = num(pool.attributes?.reserve_in_usd);
  if (liquidityUsd < MIN_LIQUIDITY_USD) return null;

  const rawSymbol = String(marketSide.token?.attributes?.symbol ?? "").toUpperCase();
  const symbol = symbolOverride(marketSide.address, rawSymbol);
  if (!symbol) return null;

  return {
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
    decimals: TOKENS.find((token) => token.symbol.toUpperCase() === symbol.toUpperCase())?.decimals ?? null,
  };
}

/**
 * Reads GeckoTerminal World Chain pool data and derives token-level market data.
 */
export async function getWorldChainMarketCatalog() {
  if (cached && cached.expiresAt > Date.now()) return cached.data;

  try {
    const settledPages = await Promise.allSettled([1, 2, 3, 4, 5, 6, 7, 8].map(fetchGeckoPage));
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
      if (volume24hUsd < MIN_VOLUME_24H_USD) continue;

      for (const side of ["base", "quote"] as const) {
        const marketSide = sideFromPool(pool, byAddress, side);
        if (!marketSide) continue;

        const market = marketFromPoolSide(pool, marketSide);
        if (!market) continue;

        const current = best.get(market.symbol);
        if (current && current.liquidityUsd >= market.liquidityUsd) continue;

        best.set(market.symbol, market);
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

export async function getWorldChainMarketForToken(tokenAddress: string, symbolHint?: string | null) {
  if (!/^0x[a-fA-F0-9]{40}$/.test(tokenAddress)) return null;
  const cacheKey = tokenAddress.toLowerCase();
  const cachedTokenMarket = tokenMarketCache.get(cacheKey);
  if (cachedTokenMarket && cachedTokenMarket.expiresAt > Date.now()) return cachedTokenMarket.data;

  try {
    const body = await fetchTokenPools(tokenAddress);
    const byAddress = new Map<string, GeckoToken>();
    for (const token of body.included ?? []) {
      const key = tokenKey(token);
      if (key) byAddress.set(key, token);
    }

    const target = tokenAddress.toLowerCase();
    let best: MarketToken | null = null;
    for (const pool of body.data ?? []) {
      for (const side of ["base", "quote"] as const) {
        const marketSide = sideFromPool(pool, byAddress, side);
        if (!marketSide || marketSide.address.toLowerCase() !== target) continue;
        const market = marketFromPoolSide(pool, marketSide);
        if (!market) continue;
        const symbol = symbolHint?.trim().toUpperCase();
        const normalized = symbol ? { ...market, symbol, name: TOKENS.find((token) => token.symbol === symbol)?.name ?? market.name } : market;
        if (!best || normalized.liquidityUsd > best.liquidityUsd) best = normalized;
      }
    }
    tokenMarketCache.set(cacheKey, { data: best, expiresAt: Date.now() + 60_000 });
    return best;
  } catch (error) {
    console.error("Failed to fetch GeckoTerminal token pools", error);
    tokenMarketCache.set(cacheKey, { data: null, expiresAt: Date.now() + 20_000 });
    return null;
  }
}

export type WorldChainMarketMode = "gainers" | "losers" | "new" | "all";

/**
 * Returns ranked World Chain markets from GeckoTerminal pools.
 */
export async function getWorldChainMarkets(mode: WorldChainMarketMode = "gainers") {
  const catalog = (await getWorldChainMarketCatalog()).filter((market) =>
    Number(market.priceUsd || 0) > 0 &&
    Number(market.liquidityUsd || 0) >= MIN_LIQUIDITY_USD &&
    Number(market.volume24hUsd || 0) >= MIN_VOLUME_24H_USD &&
    !!market.poolAddress
  );
  if (mode === "all") return catalog;

  const changed = catalog
    .filter((market) => market.change24h !== null && Number.isFinite(Number(market.change24h)));

  if (mode === "new") {
    return catalog
      .filter((market) => !market.verified && !EXCLUDED_TOP_SYMBOLS.has(market.symbol))
      .sort((a, b) => (b.volume24hUsd || b.liquidityUsd || 0) - (a.volume24hUsd || a.liquidityUsd || 0))
      .slice(0, 10);
  }

  const ranked = changed.filter((market) => !EXCLUDED_TOP_SYMBOLS.has(market.symbol));
  if (mode === "losers") {
    return ranked
      .filter((market) => (market.change24h ?? 0) < 0)
      .sort((a, b) => (a.change24h ?? 0) - (b.change24h ?? 0))
      .slice(0, 10);
  }

  return ranked
    .filter((market) => (market.change24h ?? 0) > 0)
    .sort((a, b) => (b.change24h ?? 0) - (a.change24h ?? 0))
    .slice(0, 10);
}

export async function getPoolOhlcv(poolAddress: string, timeframe = "day", aggregate = "1", limit = "60") {
  if (!/^0x[a-fA-F0-9]{40}$/.test(poolAddress)) return [];
  const safeTimeframe = ["minute", "hour", "day"].includes(timeframe) ? timeframe : "day";
  const safeAggregate = String(Math.max(1, Math.min(30, Number.parseInt(aggregate, 10) || 1)));
  const safeLimit = String(Math.max(10, Math.min(365, Number.parseInt(limit, 10) || 60)));
  const cacheKey = `${poolAddress.toLowerCase()}:${safeTimeframe}:${safeAggregate}:${safeLimit}`;
  const cachedOhlcv = ohlcvCache.get(cacheKey);
  if (cachedOhlcv && cachedOhlcv.expiresAt > Date.now()) return cachedOhlcv.data;

  const params = new URLSearchParams({
    aggregate: safeAggregate,
    limit: safeLimit,
    currency: "usd",
  });
  const response = await fetch(`${GECKO_OHLCV_URL}/${poolAddress}/ohlcv/${safeTimeframe}?${params}`, {
    headers: { accept: "application/json" },
    next: { revalidate: 180 },
    signal: AbortSignal.timeout(7000),
  });
  if (!response.ok) throw new Error(`GeckoTerminal OHLCV responded ${response.status}`);
  const body = (await response.json()) as GeckoOhlcvResponse;
  const data = (body.data?.attributes?.ohlcv_list ?? []).map(([timestamp, open, high, low, close, volume]) => ({
    timestamp,
    open,
    high,
    low,
    close,
    volume,
  }));
  ohlcvCache.set(cacheKey, { data, expiresAt: Date.now() + 180_000 });
  return data;
}

export async function getPoolTrades(poolAddress: string, tokenAddress?: string | null) {
  if (!/^0x[a-fA-F0-9]{40}$/.test(poolAddress)) return [];
  const params = new URLSearchParams({
    trade_volume_in_usd_greater_than: "0",
  });
  if (tokenAddress && /^0x[a-fA-F0-9]{40}$/.test(tokenAddress)) {
    params.set("token", tokenAddress);
  }

  const response = await fetch(`${GECKO_POOLS_URL}/${poolAddress}/trades?${params}`, {
    headers: { accept: "application/json;version=20230203" },
    next: { revalidate: 60 },
    signal: AbortSignal.timeout(7000),
  });
  if (!response.ok) throw new Error(`GeckoTerminal trades responded ${response.status}`);
  const body = (await response.json()) as GeckoTradesResponse;

  return (body.data ?? []).slice(0, 20).map((trade): PoolTrade => {
    const attrs = trade.attributes ?? {};
    const sideRaw = String(attrs.kind ?? attrs.trade_type ?? attrs.tx_type ?? "").toLowerCase();
    const side: "buy" | "sell" = sideRaw.includes("sell") ? "sell" : "buy";
    const amount =
      stringAttr(attrs.from_token_amount) ??
      stringAttr(attrs.to_token_amount) ??
      stringAttr(attrs.amount) ??
      null;
    return {
      hash: stringAttr(attrs.tx_hash) ?? trade.id ?? null,
      side,
      timestamp: stringAttr(attrs.block_timestamp) ?? stringAttr(attrs.timestamp) ?? null,
      amount,
      amountUsd: numberOrNull(attrs.volume_in_usd ?? attrs.volume_usd ?? attrs.amount_usd),
      priceUsd: numberOrNull(attrs.price_from_in_usd ?? attrs.price_to_in_usd ?? attrs.price_in_usd),
      maker:
        stringAttr(attrs.tx_from_address) ??
        stringAttr(attrs.maker) ??
        stringAttr(attrs.from_address) ??
        null,
    };
  });
}

export async function getTokenHolders(tokenAddress: string | null) {
  if (!tokenAddress || !/^0x[a-fA-F0-9]{40}$/.test(tokenAddress)) return [];
  const response = await fetch(`${WORLDSCAN_API_URL}/tokens/${tokenAddress}/holders`, {
    headers: { accept: "application/json" },
    next: { revalidate: 300 },
    signal: AbortSignal.timeout(7000),
  });
  if (!response.ok) throw new Error(`Worldscan holders responded ${response.status}`);
  const body = (await response.json()) as WorldscanHoldersResponse;
  return (body.items ?? []).slice(0, 10).map((holder): TokenHolder => {
    const hash = holder.address_hash?.hash ?? "";
    return {
      address: hash,
      label: holder.address_hash?.name ?? null,
      balance: holder.value ?? "0",
      isContract: Boolean(holder.address_hash?.is_contract),
    };
  });
}

function stringAttr(value: unknown) {
  return typeof value === "string" && value.trim() ? value : null;
}

function numberOrNull(value: unknown) {
  const parsed = Number.parseFloat(String(value ?? ""));
  return Number.isFinite(parsed) ? parsed : null;
}
