export const PRICE_SYMBOLS = ["WLD", "USDC", "ETH", "BTC"] as const;

export type PriceSymbol = (typeof PRICE_SYMBOLS)[number];

export type MarketPrice = {
  usd: number | null;
  eur: number | null;
  jpy: number | null;
  cny: number | null;
  hkd: number | null;
  gbp: number | null;
  usd_24h_change: number | null;
  usd_market_cap: number | null;
};

export type MarketPricesResponse = Record<PriceSymbol, MarketPrice> & {
  updated_at: string;
  stale: boolean;
};

export type OnchainPricesResponse = Record<PriceSymbol, number | string | boolean | null> & {
  WLD: number | null;
  USDC: number | null;
  ETH: number | null;
  BTC: number | null;
  updatedAt: number | null;
  stale: boolean;
};

export function isFinitePrice(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}
