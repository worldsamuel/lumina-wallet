import { isAddress, type Address } from "viem";

export type SwapTokenSymbol = "WLD" | "USDC" | "ETH" | "WETH" | "WBTC";

export type SwapToken = {
  symbol: SwapTokenSymbol;
  priceSymbol: "WLD" | "USDC" | "ETH" | "BTC";
  name: string;
  address: Address;
  decimals: number;
};

export const SWAP_TOKENS: Record<SwapTokenSymbol, SwapToken> = {
  WLD: {
    symbol: "WLD",
    priceSymbol: "WLD",
    name: "Worldcoin",
    address: "0x2cFc85d8E48F8EAB294be644d9E25C3030863003",
    decimals: 18,
  },
  USDC: {
    symbol: "USDC",
    priceSymbol: "USDC",
    name: "USD Coin",
    address: "0x79A02482A880bCE3F13e09Da970dC34db4CD24d1",
    decimals: 6,
  },
  ETH: {
    symbol: "ETH",
    priceSymbol: "ETH",
    name: "Wrapped Ether",
    address: "0x4200000000000000000000000000000000000006",
    decimals: 18,
  },
  WETH: {
    symbol: "WETH",
    priceSymbol: "ETH",
    name: "Wrapped Ether",
    address: "0x4200000000000000000000000000000000000006",
    decimals: 18,
  },
  WBTC: {
    symbol: "WBTC",
    priceSymbol: "BTC",
    name: "Wrapped Bitcoin",
    address: "0x03c7054bcb39f7b2e5b2c7acb37583e32d70cfa3",
    decimals: 8,
  },
};

export function resolveSwapToken(value: unknown) {
  const symbol = String(value ?? "").trim().toUpperCase();
  if (isAddress(symbol)) return null;
  return SWAP_TOKENS[symbol as SwapTokenSymbol] ?? null;
}
