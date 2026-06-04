export const COINGECKO_IDS = {
  WLD: "worldcoin-wld",
  USDC: "usd-coin",
  ETH: "ethereum",
  BTC: "bitcoin",
  USDT: "tether",
  EURC: "euro-coin",
  ORO: "oro",
  ORB: "orb",
  LIFE: "life",
  WGEM: "world-gem",
  HUB: "human-unique-bridge",
  USOL: "solana",
} as const;

export type CoinGeckoSymbol = keyof typeof COINGECKO_IDS;
