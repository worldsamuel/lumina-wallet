import type { Address } from "viem";
import { COINGECKO_IDS, type CoinGeckoSymbol } from "./coingecko-ids";

export type TokenConfig = {
  symbol: CoinGeckoSymbol | "USDT" | "WETH" | "WBTC";
  name: string;
  decimals: number;
  logo: string;
  className: string;
  contractAddress?: Address;
  wrappedAddress?: Address;
  native?: boolean;
  coingeckoId: string;
};

/**
 * Verified World Chain mainnet tokens used by Lumina.
 */
export const TOKENS: readonly TokenConfig[] = [
  {
    symbol: "WLD",
    name: "Worldcoin",
    decimals: 18,
    logo: "",
    className: "wld",
    contractAddress: "0x2cFc85d8E48F8EAB294be644d9E25C3030863003" as Address,
    coingeckoId: COINGECKO_IDS.WLD,
  },
  {
    symbol: "USDC",
    name: "USD Coin",
    decimals: 6,
    logo: "",
    className: "usdc",
    contractAddress: "0x79A02482A880bCE3F13e09Da970dC34db4CD24d1" as Address,
    coingeckoId: COINGECKO_IDS.USDC,
  },
  {
    symbol: "USDT",
    name: "Tether USD",
    decimals: 6,
    logo: "T",
    className: "usdt",
    contractAddress: "0x102d758f688a4c1c5a80b116bd945d4455460282" as Address,
    coingeckoId: COINGECKO_IDS.USDT,
  },
  {
    symbol: "WETH",
    name: "Wrapped Ether",
    decimals: 18,
    logo: "E",
    className: "eth",
    contractAddress: "0x4200000000000000000000000000000000000006" as Address,
    coingeckoId: COINGECKO_IDS.ETH,
  },
  {
    symbol: "WBTC",
    name: "Wrapped Bitcoin",
    decimals: 8,
    logo: "B",
    className: "btc",
    contractAddress: "0x03c7054bcb39f7b2e5b2c7acb37583e32d70cfa3" as Address,
    coingeckoId: COINGECKO_IDS.BTC,
  },
  {
    symbol: "EURC",
    name: "EURC",
    decimals: 6,
    logo: "E",
    className: "eurc",
    contractAddress: "0x1C60ba0A0eD1019e8Eb035E6daF4155A5cE2380B" as Address,
    coingeckoId: COINGECKO_IDS.EURC,
  },
  {
    symbol: "ORO",
    name: "ORO",
    decimals: 18,
    logo: "O",
    className: "custom",
    contractAddress: "0xcd1E32B86953D79a6AC58e813D2EA7a1790cAb63" as Address,
    coingeckoId: COINGECKO_IDS.ORO,
  },
  {
    symbol: "ORB",
    name: "Orb",
    decimals: 18,
    logo: "O",
    className: "custom",
    contractAddress: "0xf3f92a60e6004f3982f0fde0d43602fc0a30a0db" as Address,
    coingeckoId: COINGECKO_IDS.ORB,
  },
  {
    symbol: "LIFE",
    name: "LIFE",
    decimals: 18,
    logo: "L",
    className: "custom",
    contractAddress: "0xE4D62e62013EaF065Fa3F0316384F88559C80889" as Address,
    coingeckoId: COINGECKO_IDS.LIFE,
  },
  {
    symbol: "WGEM",
    name: "World GEM",
    decimals: 18,
    logo: "W",
    className: "custom",
    contractAddress: "0xAC794B2a7F81e5778f3733AF00901d4c6Ee2A740" as Address,
    coingeckoId: COINGECKO_IDS.WGEM,
  },
  {
    symbol: "HUB",
    name: "Human Unique Bridge",
    decimals: 18,
    logo: "H",
    className: "custom",
    contractAddress: "0xd469fDA5d9522A093760902e9bE51e0c5D822D26" as Address,
    coingeckoId: COINGECKO_IDS.HUB,
  },
  {
    symbol: "USOL",
    name: "Wrapped Solana (Universal)",
    decimals: 18,
    logo: "S",
    className: "custom",
    contractAddress: "0x9B8Df6E244526ab5F6e6400d331DB28C8fdDdb55" as Address,
    coingeckoId: COINGECKO_IDS.USOL,
  },
  {
    symbol: "ETH",
    name: "Ether",
    decimals: 18,
    logo: "E",
    className: "eth",
    native: true,
    wrappedAddress: "0x4200000000000000000000000000000000000006" as Address,
    coingeckoId: COINGECKO_IDS.ETH,
  },
];

export const ERC20_TOKENS = TOKENS.filter(
  (token): token is TokenConfig & { contractAddress: Address } => Boolean(token.contractAddress),
);

export function getTokenBySymbol(symbol: string) {
  return TOKENS.find((token) => token.symbol.toLowerCase() === symbol.toLowerCase()) ?? null;
}

export function getTokenLogoAddress(symbol: string) {
  const token = getTokenBySymbol(symbol);
  return token?.contractAddress ?? token?.wrappedAddress ?? null;
}
