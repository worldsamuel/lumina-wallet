// World Chain Morpho vault data.
// Source: https://api.morpho.org/graphql (queried 2026-05-30).
// Verification: compared against World App's built-in vault feature; contract addresses match.

export type RiskLevel = "low" | "medium" | "high";

export interface MorphoVault {
  /** Vault contract address (ERC-4626). */
  address: `0x${string}`;
  /** Display name. */
  displayName: string;
  /** Underlying asset token information. */
  asset: {
    address: `0x${string}`;
    symbol: string;
    decimals: number;
  };
  /** Default UI risk level. Live risk data can still come from the API. */
  riskLevel: RiskLevel;
  /** Disabled vaults are hidden from the frontend. */
  enabled: boolean;
  /** Optional admin-uploaded image shown in Earn product cards. */
  imageUrl?: string | null;
  /** Localized description copy. */
  description: {
    "zh-CN": string;
    en: string;
  };
}

export const WORLD_CHAIN_ID = 480;

export const MORPHO_API_ENDPOINT = "https://api.morpho.org/graphql";

export const RE7_VAULTS: MorphoVault[] = [
  {
    address: "0xb1E80387EbE53Ff75a89736097D34dC8D9E9045B",
    displayName: "Re7 USDC",
    asset: {
      address: "0x79A02482A880bCE3F13e09Da970dC34db4CD24d1",
      symbol: "USDC",
      decimals: 6,
    },
    riskLevel: "low",
    enabled: true,
    description: {
      "zh-CN": "稳定币 USDC 借贷理财,由 Re7 Labs 策展,Morpho 协议底层",
      en: "USDC stablecoin lending vault, curated by Re7 Labs on Morpho",
    },
  },
  {
    address: "0x348831b46876d3dF2Db98BdEc5E3B4083329Ab9f",
    displayName: "Re7 WLD",
    asset: {
      address: "0x2cFc85d8E48F8EAB294be644d9E25C3030863003",
      symbol: "WLD",
      decimals: 18,
    },
    riskLevel: "medium",
    enabled: true,
    description: {
      "zh-CN": "WLD 借贷理财,由 Re7 Labs 策展,Morpho 协议底层",
      en: "WLD lending vault, curated by Re7 Labs on Morpho",
    },
  },
  {
    address: "0x0Db7E405278c2674F462aC9D9eb8b8346D1c1571",
    displayName: "Re7 WETH",
    asset: {
      address: "0x4200000000000000000000000000000000000006",
      symbol: "WETH",
      decimals: 18,
    },
    riskLevel: "medium",
    enabled: true,
    description: {
      "zh-CN": "WETH 借贷理财,由 Re7 Labs 策展,Morpho 协议底层",
      en: "WETH lending vault, curated by Re7 Labs on Morpho",
    },
  },
  {
    address: "0xDaa79e066DeE8c8C15FFb37b1157F7Eb8e0d1b37",
    displayName: "Re7 EURC",
    asset: {
      address: "0x1C60ba0A0eD1019e8Eb035E6daF4155A5cE2380B",
      symbol: "EURC",
      decimals: 6,
    },
    riskLevel: "low",
    enabled: true,
    description: {
      "zh-CN": "欧元稳定币 EURC 借贷理财",
      en: "EURC (Euro stablecoin) lending vault",
    },
  },
  {
    address: "0x1C94c7A2c71ECF13104c31F49d5138EDb099D25D",
    displayName: "Re7 wARS",
    asset: {
      address: "0x0DC4F92879B7670e5f4e4e6e3c801D229129D90D",
      symbol: "wARS",
      decimals: 18,
    },
    riskLevel: "high",
    enabled: false,
    description: {
      "zh-CN": "阿根廷比索 wARS 借贷理财(高波动)",
      en: "wARS (Argentine Peso) lending vault - high volatility",
    },
  },
  {
    address: "0xBC8C37467c5Df9D50B42294B8628c25888BECF61",
    displayName: "Re7 WBTC",
    asset: {
      address: "0x03C7054BCB39f7b2e5B2c7AcB37583e32D70Cfa3",
      symbol: "WBTC",
      decimals: 8,
    },
    riskLevel: "medium",
    enabled: false,
    description: {
      "zh-CN": "WBTC 借贷理财(暂无收益,流动性不足)",
      en: "WBTC vault - currently no yield (low liquidity)",
    },
  },
];

export function getEnabledVaults(): MorphoVault[] {
  return RE7_VAULTS.filter((vault) => vault.enabled);
}

export function getVaultByAddress(address: string): MorphoVault | undefined {
  return RE7_VAULTS.find((vault) => vault.address.toLowerCase() === address.toLowerCase());
}
