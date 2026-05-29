import type { Address } from "viem";

export type TokenConfig = {
  symbol: string;
  name: string;
  decimals: number;
  logo: string;
  className: string;
  contractAddress?: Address;
  native?: boolean;
  // TODO: Replace static placeholders with a price feed in the next pricing step.
  priceUsd: number;
};

/**
 * Verified World Chain mainnet tokens used by Lumina.
 */
export const TOKENS: readonly TokenConfig[] = [
  {
    symbol: "WLD",
    name: "Worldcoin",
    decimals: 18,
    logo: "◉",
    className: "wld",
    contractAddress: "0x2cFc85d8E48F8EAB294be644d9E25C3030863003" as Address,
    priceUsd: 0,
  },
  {
    symbol: "USDC",
    name: "USD Coin",
    decimals: 6,
    logo: "$",
    className: "usdc",
    contractAddress: "0x79A02482A880bCE3F13e09Da970dC34db4CD24d1" as Address,
    priceUsd: 0,
  },
  {
    symbol: "ETH",
    name: "Ether",
    decimals: 18,
    logo: "◆",
    className: "eth",
    native: true,
    priceUsd: 0,
  },
];

export const ERC20_TOKENS = TOKENS.filter(
  (token): token is TokenConfig & { contractAddress: Address } => Boolean(token.contractAddress),
);

/**
 * Finds a token by ticker symbol.
 */
export function getTokenBySymbol(symbol: string) {
  return TOKENS.find((token) => token.symbol.toLowerCase() === symbol.toLowerCase()) ?? null;
}
