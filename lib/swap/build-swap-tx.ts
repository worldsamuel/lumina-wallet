import { Trade as RouterTrade } from "@uniswap/router-sdk";
import { SwapRouter } from "@uniswap/universal-router-sdk";
import { Pool, Route } from "@uniswap/v3-sdk";
import { CurrencyAmount, Percent, Token, TradeType } from "@uniswap/sdk-core";
import { decodeFunctionData, isAddress, type Address } from "viem";
import { publicClient } from "@/lib/chain";
import {
  UNIVERSAL_ROUTER_ADDRESS,
  UNISWAP_V3_FACTORY,
  WORLD_CHAIN_ID,
  v3FactoryAbi,
  v3PoolAbi,
} from "./contracts";
import { SWAP_TOKENS } from "./tokens";

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
  route?: {
    tokens: string[];
    fees: number[];
  };
  slippageBps: number;
  userAddress: Address;
  deadline: number;
  platformFee?: {
    recipient: Address;
    bps: number;
  } | null;
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
  route: quotedRoute,
  slippageBps,
  userAddress,
  deadline,
  platformFee,
}: BuildSwapTransactionParams): Promise<BuiltSwapTransaction> {
  if (!isAddress(userAddress)) throw new Error("Invalid swap recipient.");
  if (fromAmount <= 0n || expectedAmountOut <= 0n) throw new Error("Swap amounts must be greater than 0.");
  if (slippageBps <= 0) throw new Error("Slippage cannot be 0.");

  const routeTokens = resolveRouteTokens(fromToken, toToken, quotedRoute);
  const fromCurrency = toSdkToken(routeTokens[0]);
  const toCurrency = toSdkToken(routeTokens[routeTokens.length - 1]);
  const routeFees = quotedRoute?.fees?.length === routeTokens.length - 1 ? quotedRoute.fees : [feeTier];
  const pools = await Promise.all(
    routeFees.map((fee, index) => getV3Pool(toSdkToken(routeTokens[index]), toSdkToken(routeTokens[index + 1]), fee)),
  );
  const route = new Route(pools, fromCurrency, toCurrency);
  const inputAmount = CurrencyAmount.fromRawAmount(fromCurrency, fromAmount.toString());
  const outputAmount = CurrencyAmount.fromRawAmount(toCurrency, expectedAmountOut.toString());
  const trade = new RouterTrade({
    v3Routes: [{ routev3: route, inputAmount, outputAmount }],
    tradeType: TradeType.EXACT_INPUT,
  });

  const feeConfig = platformFee && platformFee.bps > 0 ? platformFee : null;
  console.log("[SWAP] fee config:", feeConfig);

  const { calldata, value } = SwapRouter.swapCallParameters(trade, {
    recipient: userAddress,
    slippageTolerance: new Percent(slippageBps, 10_000),
    deadlineOrPreviousBlockhash: deadline,
    chainId: WORLD_CHAIN_ID,
    fee:
      feeConfig
        ? {
            fee: new Percent(feeConfig.bps, 10_000),
            recipient: feeConfig.recipient,
          }
        : undefined,
  });

  const decoded = decodeUniversalRouterExecute(calldata as `0x${string}`);
  console.log("[SWAP DEBUG] build route:", {
    from: fromToken.symbol,
    to: toToken.symbol,
    routeTokens: routeTokens.map((token) => token.address),
    routeFees,
  });
  console.log("[SWAP DEBUG] universal router commands:", decoded?.commands ?? null);
  console.log("[SWAP DEBUG] universal router inputs lengths:", decoded?.inputLengths ?? null);

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

function resolveRouteTokens(fromToken: SwapTokenLike, toToken: SwapTokenLike, quotedRoute?: { tokens: string[]; fees: number[] }) {
  if (!quotedRoute?.tokens?.length || quotedRoute.tokens.length < 2) return [fromToken, toToken];
  const known = [fromToken, toToken, ...Object.values(SWAP_TOKENS)];
  const routeTokens = quotedRoute.tokens.map((address) => {
    const token = known.find((item) => item.address.toLowerCase() === address.toLowerCase());
    if (!token) throw new Error("Swap route contains an unknown token.");
    return token;
  });
  if (routeTokens[0].address.toLowerCase() !== fromToken.address.toLowerCase()) {
    throw new Error("Swap route input mismatch.");
  }
  if (routeTokens[routeTokens.length - 1].address.toLowerCase() !== toToken.address.toLowerCase()) {
    throw new Error("Swap route output mismatch.");
  }
  return routeTokens;
}

const universalRouterExecuteAbi = [
  {
    type: "function",
    name: "execute",
    stateMutability: "payable",
    inputs: [
      { name: "commands", type: "bytes" },
      { name: "inputs", type: "bytes[]" },
      { name: "deadline", type: "uint256" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "execute",
    stateMutability: "payable",
    inputs: [
      { name: "commands", type: "bytes" },
      { name: "inputs", type: "bytes[]" },
    ],
    outputs: [],
  },
] as const;

function decodeUniversalRouterExecute(data: `0x${string}`) {
  try {
    const decoded = decodeFunctionData({ abi: universalRouterExecuteAbi, data });
    const inputs = decoded.args[1] as readonly `0x${string}`[];
    return {
      commands: String(decoded.args[0]),
      inputLengths: inputs.map((input) => input.length),
    };
  } catch {
    return null;
  }
}
