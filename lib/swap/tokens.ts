import { isAddress, type Address } from "viem";

export type SwapTokenSymbol =
  | "WLD"
  | "USDC"
  | "USDT"
  | "ETH"
  | "WETH"
  | "BTC"
  | "WBTC"
  | "EURC"
  | "ORO"
  | "ORB"
  | "LIFE"
  | "WGEM";
export type SwapTokenTrust = "core" | "alias" | "audited" | "community";

export type SwapToken = {
  symbol: string;
  priceSymbol: "WLD" | "USDC" | "ETH" | "BTC";
  name: string;
  address: Address;
  decimals: number;
  trust?: SwapTokenTrust;
  safety?: unknown;
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
  USDT: {
    symbol: "USDT",
    priceSymbol: "USDC",
    name: "Tether USD",
    address: "0x102d758f688a4C1C5a80b116bD945d4455460282",
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
  BTC: {
    symbol: "WBTC",
    priceSymbol: "BTC",
    name: "Wrapped Bitcoin",
    address: "0x03c7054bcb39f7b2e5b2c7acb37583e32d70cfa3",
    decimals: 8,
    trust: "alias",
  },
  EURC: {
    symbol: "EURC",
    priceSymbol: "USDC",
    name: "EURC",
    address: "0x1C60ba0A0eD1019e8Eb035E6daF4155A5cE2380B",
    decimals: 6,
  },
  ORO: {
    symbol: "ORO",
    priceSymbol: "USDC",
    name: "ORO",
    address: "0xcd1E32B86953D79a6AC58e813D2EA7a1790cAb63",
    decimals: 18,
  },
  ORB: {
    symbol: "ORB",
    priceSymbol: "USDC",
    name: "Orb",
    address: "0xF3F92A60e6004f3982F0FdE0d43602fC0a30a0dB",
    decimals: 18,
  },
  LIFE: {
    symbol: "LIFE",
    priceSymbol: "USDC",
    name: "LIFE",
    address: "0xE4D62e62013EaF065Fa3F0316384F88559C80889",
    decimals: 18,
  },
  WGEM: {
    symbol: "WGEM",
    priceSymbol: "USDC",
    name: "World GEM",
    address: "0xAC794B2a7F81e5778f3733AF00901d4c6Ee2A740",
    decimals: 18,
  },
};

export const VERIFIED_SWAP_TOKENS: Record<string, SwapToken & { auditDate?: string; auditNotes?: string; riskLevel?: string }> = {};

export function resolveSwapToken(value: unknown): SwapToken | null {
  const symbol = String(value ?? "").trim().toUpperCase();
  if (isAddress(symbol)) return null;
  const token = SWAP_TOKENS[symbol as SwapTokenSymbol] ?? VERIFIED_SWAP_TOKENS[symbol];
  return token ? { ...token, trust: token.trust ?? (SWAP_TOKENS[symbol as SwapTokenSymbol] ? "core" : "audited") } : null;
}

export function resolveCoreSwapToken(value: unknown) {
  return resolveSwapToken(value);
}

export function swapTokenInput(value: unknown) {
  const text = String(value ?? "").trim();
  return isAddress(text) ? (text as Address) : text.toUpperCase();
}
