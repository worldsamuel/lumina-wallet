export const COINGECKO_IDS = {
  WLD: "worldcoin-wld",
  USDC: "usd-coin",
  ETH: "ethereum",
  BTC: "bitcoin",
  USDT: "tether",
} as const;

export type CoinGeckoSymbol = keyof typeof COINGECKO_IDS;
