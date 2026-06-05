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
  | "WGEM"
  | "HUB";
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
    address: "0xf3f92a60e6004f3982f0fde0d43602fc0a30a0db",
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
  HUB: {
    symbol: "HUB",
    priceSymbol: "USDC",
    name: "Human Unique Bridge",
    address: "0xd469fDA5d9522A093760902e9bE51e0c5D822D26",
    decimals: 18,
  },
};

export const VERIFIED_SWAP_TOKENS: Record<string, SwapToken & { auditDate?: string; auditNotes?: string; riskLevel?: string }> = {
  USDT0: {
    symbol: "USDT0",
    priceSymbol: "USDC",
    name: "Stargate USDt0 (Bridged)",
    address: "0x102d758f688a4C1C5a80b116bD945d4455460282",
    decimals: 6,
    auditDate: "2026-06-05",
    auditNotes: "World Chain Top token audit: official bridged stablecoin.",
    riskLevel: "verified",
  },
  SUSHI: {
    symbol: "SUSHI",
    priceSymbol: "USDC",
    name: "SUSHI Token",
    address: "0xab09A728E53d3d6BC438BE95eeD46Da0Bbe7FB38",
    decimals: 18,
    auditDate: "2026-06-05",
    auditNotes: "World Chain Top token audit: sellback ratio 0.83.",
    riskLevel: "warning",
  },
  WDD: {
    symbol: "WDD",
    priceSymbol: "USDC",
    name: "Drachma",
    address: "0xEdE54d9c024ee80C85ec0a75eD2d8774c7Fbac9B",
    decimals: 18,
    auditDate: "2026-06-05",
    auditNotes: "World Chain Top token audit: sellback ratio 0.98.",
    riskLevel: "verified",
  },
  SEED: {
    symbol: "SEED",
    priceSymbol: "USDC",
    name: "SEED Token",
    address: "0x0458965C6A85b14E022C1920276197c972f0Fd2f",
    decimals: 18,
    auditDate: "2026-06-05",
    auditNotes: "World Chain Top token audit: sellback ratio 0.86.",
    riskLevel: "warning",
  },
  WARS: {
    symbol: "wARS",
    priceSymbol: "USDC",
    name: "Peso Argentino",
    address: "0x0DC4F92879B7670e5f4e4e6e3c801D229129D90D",
    decimals: 18,
    auditDate: "2026-06-05",
    auditNotes: "World Chain Top token audit: sellback ratio 0.96, pausable.",
    riskLevel: "warning",
  },
  CHAD: {
    symbol: "CHAD",
    priceSymbol: "USDC",
    name: "Chad",
    address: "0x50723A159ba02A1ADA4d7E1A32835f7ff1F1bE89",
    decimals: 18,
    auditDate: "2026-06-05",
    auditNotes: "World Chain Top token audit: sellback ratio 0.98.",
    riskLevel: "warning",
  },
  FUTX: {
    symbol: "FUTX",
    priceSymbol: "USDC",
    name: "FutureX",
    address: "0x5FD95419576265f51832cD0C052973F2BbBAbA44",
    decimals: 18,
    auditDate: "2026-06-05",
    auditNotes: "World Chain Top token audit: sellback ratio 0.99.",
    riskLevel: "warning",
  },
  FRUIT: {
    symbol: "FRUIT",
    priceSymbol: "USDC",
    name: "FruitToken",
    address: "0xdBB7bE091f5aDddb22ebC7117De52bcc4c93FFb0",
    decimals: 18,
    auditDate: "2026-06-05",
    auditNotes: "World Chain Top token audit: sellback ratio 0.97.",
    riskLevel: "verified",
  },
  NG: {
    symbol: "NG",
    priceSymbol: "USDC",
    name: "Naked Gun",
    address: "0x0d3d3d381892A945BE218030223bAF7Fe938d90E",
    decimals: 18,
    auditDate: "2026-06-05",
    auditNotes: "World Chain Top token audit: sellback ratio 0.99.",
    riskLevel: "warning",
  },
  BULL: {
    symbol: "BULL",
    priceSymbol: "USDC",
    name: "Bull Farm Token",
    address: "0x1B1F1F29B76d83B30CaAcb7326CD325A0Bb7E9f0",
    decimals: 18,
    auditDate: "2026-06-05",
    auditNotes: "World Chain Top token audit: sellback ratio 0.97.",
    riskLevel: "warning",
  },
  USOL: {
    symbol: "uSOL",
    priceSymbol: "USDC",
    name: "Solana (Universal)",
    address: "0x9B8Df6E244526ab5F6e6400d331DB28C8fdDdb55",
    decimals: 18,
    auditDate: "2026-06-05",
    auditNotes: "World Chain Top token audit: sellback ratio 0.95, owner.",
    riskLevel: "warning",
  },
  ANIX: {
    symbol: "ANIX",
    priceSymbol: "USDC",
    name: "AniX",
    address: "0xcd7Abb83918984A0Bb10a02f8656923041777369",
    decimals: 18,
    auditDate: "2026-06-05",
    auditNotes: "World Chain Top token audit: sellback ratio 0.98, owner.",
    riskLevel: "warning",
  },
  PUF: {
    symbol: "PUF",
    priceSymbol: "USDC",
    name: "PUF",
    address: "0x1aE3498f1B417fe31BE544B04B711F27Ba437bd3",
    decimals: 18,
    auditDate: "2026-06-05",
    auditNotes: "World Chain Top token audit: sellback ratio 0.88, owner.",
    riskLevel: "warning",
  },
  OXAUT: {
    symbol: "oXAUT",
    priceSymbol: "USDC",
    name: "OpenXAUT",
    address: "0x30974f73A4ac9E606Ed80da928e454977ac486D2",
    decimals: 6,
    auditDate: "2026-06-05",
    auditNotes: "World Chain Top token audit: sellback ratio 0.98, owner.",
    riskLevel: "warning",
  },
  DC: {
    symbol: "DC",
    priceSymbol: "USDC",
    name: "DC",
    address: "0x2F4d788295ba13f7746b3A46FFFC17756EDd1743",
    decimals: 18,
    auditDate: "2026-06-05",
    auditNotes: "World Chain Top token audit: sellback ratio 0.97, owner.",
    riskLevel: "warning",
  },
};

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
