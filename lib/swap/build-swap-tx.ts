import { encodeFunctionData, isAddress, type Address } from "viem";
import { UNISWAP_V3_SWAP_ROUTER_02, v3SwapRouterAbi } from "./contracts";

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
  route,
  slippageBps,
  userAddress,
}: BuildSwapTransactionParams): Promise<BuiltSwapTransaction> {
  if (!isAddress(userAddress)) throw new Error("Invalid swap recipient.");
  if (fromAmount <= 0n || expectedAmountOut <= 0n) throw new Error("Swap amounts must be greater than 0.");
  if (slippageBps <= 0) throw new Error("Slippage cannot be 0.");
  assertDirectV3Route(fromToken, toToken, route);

  const amountOutMinimum = applySlippage(expectedAmountOut, slippageBps);
  const data = encodeFunctionData({
    abi: v3SwapRouterAbi,
    functionName: "exactInputSingle",
    args: [
      {
        tokenIn: fromToken.address,
        tokenOut: toToken.address,
        fee: feeTier,
        recipient: userAddress,
        amountIn: fromAmount,
        amountOutMinimum,
        sqrtPriceLimitX96: 0n,
      },
    ],
  });

  console.log("[SWAP DEBUG] v3 swap router:", UNISWAP_V3_SWAP_ROUTER_02);
  console.log("[SWAP DEBUG] v3 exactInputSingle:", {
    tokenIn: fromToken.address,
    tokenOut: toToken.address,
    fee: feeTier,
    recipient: userAddress,
    amountIn: fromAmount.toString(),
    amountOutMinimum: amountOutMinimum.toString(),
  });

  return {
    to: UNISWAP_V3_SWAP_ROUTER_02,
    data,
    value: "0x0",
  };
}

function assertDirectV3Route(fromToken: SwapTokenLike, toToken: SwapTokenLike, route?: { tokens: string[]; fees: number[] }) {
  if (!route?.tokens?.length) return;
  if (route.tokens.length !== 2 || route.fees.length !== 1) {
    throw new Error("Direct V3 SwapRouter execution currently supports single-pool routes only.");
  }
  if (route.tokens[0].toLowerCase() !== fromToken.address.toLowerCase()) {
    throw new Error("Swap route input mismatch.");
  }
  if (route.tokens[1].toLowerCase() !== toToken.address.toLowerCase()) {
    throw new Error("Swap route output mismatch.");
  }
}

function applySlippage(amount: bigint, slippageBps: number) {
  return (amount * BigInt(10_000 - slippageBps)) / 10_000n;
}
