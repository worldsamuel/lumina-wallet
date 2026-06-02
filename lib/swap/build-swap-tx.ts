import { Trade as RouterTrade } from "@uniswap/router-sdk";
import { SwapRouter } from "@uniswap/universal-router-sdk";
import { Pool, Route } from "@uniswap/v3-sdk";
import { CurrencyAmount, Percent, Token, TradeType } from "@uniswap/sdk-core";
import { isAddress, type Address } from "viem";
import { publicClient } from "@/lib/chain";
import {
  UNIVERSAL_ROUTER_ADDRESS,
  UNISWAP_V3_FACTORY,
  WORLD_CHAIN_ID,
  v3FactoryAbi,
  v3PoolAbi,
} from "./contracts";

type SwapTokenLike = {
  address: Address;
  symbol: string;
  decimals: number;
  name?: string;
};

type BuildSwapTransactionParams = {
  fromToken: SwapTokenLike;
  toToken: SwapTokenLike;
  fromAmount: bigint;
  expectedAmountOut: bigint;
  feeTier: number;
  slippageBps: number;
  userAddress: Address;
  deadline: number;
};

export type BuiltSwapTransaction = {
  to: Address;
  data: `0x${string}`;
  value: `0x${string}`;
};

export async function buildSwapTransaction({
  fromToken,
  toToken,
  fromAmount,
  expectedAmountOut,
  feeTier,
  slippageBps,
  userAddress,
  deadline,
}: BuildSwapTransactionParams): Promise<BuiltSwapTransaction> {
  if (!isAddress(userAddress)) throw new Error("Invalid swap recipient.");
  if (fromAmount <= 0n || expectedAmountOut <= 0n) throw new Error("Swap amounts must be greater than 0.");
  if (slippageBps <= 0) throw new Error("Slippage cannot be 0.");

  const fromCurrency = toSdkToken(fromToken);
  const toCurrency = toSdkToken(toToken);
  const pool = await getV3Pool(fromCurrency, toCurrency, feeTier);
  const route = new Route([pool], fromCurrency, toCurrency);
  const inputAmount = CurrencyAmount.fromRawAmount(fromCurrency, fromAmount.toString());
  const outputAmount = CurrencyAmount.fromRawAmount(toCurrency, expectedAmountOut.toString());
  const trade = new RouterTrade({
    v3Routes: [{ routev3: route, inputAmount, outputAmount }],
    tradeType: TradeType.EXACT_INPUT,
  });

  const { calldata, value } = SwapRouter.swapCallParameters(trade, {
    recipient: userAddress,
    slippageTolerance: new Percent(slippageBps, 10_000),
    deadlineOrPreviousBlockhash: deadline,
    chainId: WORLD_CHAIN_ID,
  });

  return {
    to: UNIVERSAL_ROUTER_ADDRESS,
    data: calldata as `0x${string}`,
    value: (value && value !== "0" ? value : "0x0") as `0x${string}`,
  };
}

function toSdkToken(token: SwapTokenLike) {
  return new Token(WORLD_CHAIN_ID, token.address, token.decimals, token.symbol, token.name ?? token.symbol);
}

async function getV3Pool(tokenA: Token, tokenB: Token, feeTier: number) {
  const poolAddress = await publicClient.readContract({
    address: UNISWAP_V3_FACTORY,
    abi: v3FactoryAbi,
    functionName: "getPool",
    args: [tokenA.address as Address, tokenB.address as Address, feeTier],
  });
  if (!poolAddress || poolAddress === "0x0000000000000000000000000000000000000000") {
    throw new Error("Selected Uniswap V3 pool does not exist.");
  }

  const [slot0, liquidity] = await Promise.all([
    publicClient.readContract({ address: poolAddress, abi: v3PoolAbi, functionName: "slot0" }),
    publicClient.readContract({ address: poolAddress, abi: v3PoolAbi, functionName: "liquidity" }),
  ]);

  return new Pool(tokenA, tokenB, feeTier, slot0[0].toString(), liquidity.toString(), Number(slot0[1]));
}
