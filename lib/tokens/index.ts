import type { Address } from "viem";
import { COINGECKO_IDS, type CoinGeckoSymbol } from "./coingecko-ids";

export type TokenConfig = {
  symbol: CoinGeckoSymbol | "USDT";
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
    logo: "W",
    className: "wld",
    contractAddress: "0x2cFc85d8E48F8EAB294be644d9E25C3030863003" as Address,
    coingeckoId: COINGECKO_IDS.WLD,
  },
  {
    symbol: "USDC",
    name: "USD Coin",
    decimals: 6,
    logo: "U",
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
