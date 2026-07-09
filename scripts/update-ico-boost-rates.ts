import { getSystemConfig, updateSystemConfig } from "@/lib/admin/system-config";

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
    minAmount: 1,
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
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
