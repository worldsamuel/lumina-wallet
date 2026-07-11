import { getSystemConfig, updateSystemConfig } from "@/lib/admin/system-config";
import { upsertPointsProduct } from "@/lib/admin/points-products";

const paymentTokens = [
  {
    symbol: "WLD",
    address: "0x2cFc85d8E48F8EAB294be644d9E25C3030863003",
    decimals: 18,
    minAmount: 0.1,
    maxAmount: 1000,
    luminaRate: 1000,
    quoteAmount: 1,
    boostMultiplier: 1,
  },
  {
    symbol: "USDC",
    address: "0x79A02482A880bCE3F13e09Da970dC34db4CD24d1",
    decimals: 6,
    minAmount: 0.1,
    maxAmount: 300,
    luminaRate: 5000,
    quoteAmount: 1,
    boostMultiplier: 2,
  },
  {
    symbol: "BTC",
    paySymbol: "WBTC",
    address: "0x03c7054bcb39f7b2e5b2c7acb37583e32d70cfa3",
    decimals: 8,
    minAmount: 0.0001,
    maxAmount: 0.01,
    luminaRate: 650000000,
    quoteAmount: 0.001,
    boostMultiplier: 4,
  },
  {
    symbol: "ETH",
    address: null,
    decimals: 18,
    minAmount: 0.001,
    maxAmount: 0.5,
    luminaRate: 13500000,
    quoteAmount: 0.001,
    boostMultiplier: 3,
  },
];

async function main() {
  const current = await getSystemConfig();
  const next = await updateSystemConfig({
    ico: {
      ...(current.ico || {}),
      enabled: current.ico?.enabled !== false,
      rate: 1000,
      maxWld: 1000,
      paymentTokens,
    },
  });

  console.log(
    JSON.stringify(
      next.ico.paymentTokens.map((token) => ({
        symbol: token.symbol,
        luminaRate: token.luminaRate,
        quoteAmount: token.quoteAmount,
        boostMultiplier: token.boostMultiplier,
      })),
      null,
      2,
    ),
  );
  await upsertPointsProduct({
    id: "ico-token-mystery-box",
    type: "blind_box",
    title: "ICO Token Mystery Box",
    titleI18n: { en: "ICO Token Mystery Box", "zh-CN": "ICO 代币盲盒", "zh-TW": "ICO 代幣盲盒", ja: "ICOトークンミステリーボックス", fr: "Boîte mystère ICO" },
    category: "alpha",
    points: 0,
    originalPoints: null,
    icoRequired: true,
    hideRewardAmounts: true,
    iconUrl: "/points/lumina-points-icon.png",
    imageText: null,
    badge: "ICO",
    countries: ["global"],
    stock: 5000,
    purchaseLimit: 1,
    enabled: true,
    sortOrder: 7,
    description: "Users who reserved LUMINA in the ICO can open once.",
    descriptionI18n: { en: "Users who reserved LUMINA in the ICO can open once.", "zh-CN": "只要参与过 ICO 认购，就可以开启一次。", "zh-TW": "只要參與過 ICO 認購，就可以開啟一次。", ja: "ICOに参加したユーザーは1回開けられます。", fr: "Les utilisateurs ayant participé à l'ICO peuvent l'ouvrir une fois." },
    rewards: [
      { id: "usdc", name: "USDC", value: null, symbol: "USDC", minAmount: 0.001, maxAmount: 1, rareMaxOdds: 0.01, odds: 2200, stock: null },
      { id: "wld", name: "WLD", value: null, symbol: "WLD", minAmount: 0.01, maxAmount: 1, rareMaxOdds: 0.01, odds: 2200, stock: null },
      { id: "doge", name: "DOGE", value: null, symbol: "DOGE", minAmount: 1, maxAmount: 100, odds: 1900, stock: null },
      { id: "sui", name: "SUI", value: null, symbol: "SUI", minAmount: 0.01, maxAmount: 2, odds: 1900, stock: null },
      { id: "xrp", name: "XRP", value: null, symbol: "XRP", minAmount: 0.1, maxAmount: 10, odds: 1800, stock: null },
    ],
  });
  console.log("ICO mystery box upserted.");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
