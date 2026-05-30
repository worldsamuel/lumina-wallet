import { formatUnits, type Address } from "viem";
import { publicClient } from "./chain";
import { PRICE_SYMBOLS, type OnchainPricesResponse, type PriceSymbol } from "./prices";

export const CHAINLINK_FEEDS: Record<PriceSymbol, Address> = {
  WLD: "0x8Bb2943AB030E3eE05a58d9832525B4f60A97FA0",
  ETH: "0xe1d72a719171DceAB9499757EB9d5AEb9e8D64A6",
  USDC: "0xF4301686AfF4eE36d70c718a9e62309b53862BE8",
  BTC: "0xdD91675235C37a47597c053807d61Da27Ae1AE6C",
};

export const aggregatorV3Abi = [
  {
    type: "function",
    name: "decimals",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint8" }],
  },
  {
    type: "function",
    name: "latestRoundData",
    stateMutability: "view",
    inputs: [],
    outputs: [
      { name: "roundId", type: "uint80" },
      { name: "answer", type: "int256" },
      { name: "startedAt", type: "uint256" },
      { name: "updatedAt", type: "uint256" },
      { name: "answeredInRound", type: "uint80" },
    ],
  },
] as const;

export type OraclePrice = {
  price: bigint;
  decimals: number;
  updatedAt: number;
};

export async function readOraclePrice(symbol: PriceSymbol): Promise<OraclePrice> {
  const address = CHAINLINK_FEEDS[symbol];
  const [decimals, latest] = await Promise.all([
    publicClient.readContract({ address, abi: aggregatorV3Abi, functionName: "decimals" }),
    publicClient.readContract({ address, abi: aggregatorV3Abi, functionName: "latestRoundData" }),
  ]);
  return {
    price: latest[1],
    decimals,
    updatedAt: Number(latest[3]),
  };
}

export async function readOraclePrices(): Promise<OnchainPricesResponse> {
  const contracts = PRICE_SYMBOLS.flatMap((symbol) => [
    {
      address: CHAINLINK_FEEDS[symbol],
      abi: aggregatorV3Abi,
      functionName: "latestRoundData",
    },
    {
      address: CHAINLINK_FEEDS[symbol],
      abi: aggregatorV3Abi,
      functionName: "decimals",
    },
  ]);

  const results = await publicClient.multicall({
    allowFailure: false,
    contracts,
  });

  const payload: OnchainPricesResponse = {
    WLD: null,
    USDC: null,
    ETH: null,
    BTC: null,
    updatedAt: null,
    stale: false,
  };

  PRICE_SYMBOLS.forEach((symbol, index) => {
    const latest = results[index * 2] as readonly [bigint, bigint, bigint, bigint, bigint];
    const decimals = Number(results[index * 2 + 1]);
    const answer = latest[1];
    const updatedAt = Number(latest[3]);
    payload[symbol] = answer > 0n ? Number(formatUnits(answer, decimals)) : null;
    payload.updatedAt = Math.max(payload.updatedAt ?? 0, updatedAt);
  });

  return payload;
}
