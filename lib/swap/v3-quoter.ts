import { formatUnits, type Address } from "viem";
import { publicClient } from "@/lib/chain";
import type { SwapQuoteResult, SwapQuoteSet } from "./quote-types";
import type { SwapToken } from "./tokens";

const UNISWAP_V3_QUOTER_V2 = "0x10158D43e6cc414deE1Bd1eB0EfC6a5cBCfF244c" as Address;
const FEE_TIERS = [500, 3000, 10000] as const;

const quoterV2Abi = [
  {
    type: "function",
    name: "quoteExactInputSingle",
    stateMutability: "nonpayable",
    inputs: [
      {
        name: "params",
        type: "tuple",
        components: [
          { name: "tokenIn", type: "address" },
          { name: "tokenOut", type: "address" },
          { name: "amountIn", type: "uint256" },
          { name: "fee", type: "uint24" },
          { name: "sqrtPriceLimitX96", type: "uint160" },
        ],
      },
    ],
    outputs: [
      { name: "amountOut", type: "uint256" },
      { name: "sqrtPriceX96After", type: "uint160" },
      { name: "initializedTicksCrossed", type: "uint32" },
      { name: "gasEstimate", type: "uint256" },
    ],
  },
] as const;

export async function quoteV3(
  fromToken: SwapToken,
  toToken: SwapToken,
  amountIn: bigint,
  feeTier: (typeof FEE_TIERS)[number],
): Promise<SwapQuoteResult> {
  const simulated = await publicClient.simulateContract({
    address: UNISWAP_V3_QUOTER_V2,
    abi: quoterV2Abi,
    functionName: "quoteExactInputSingle",
    args: [
      {
        tokenIn: fromToken.address,
        tokenOut: toToken.address,
        amountIn,
        fee: feeTier,
        sqrtPriceLimitX96: 0n,
      },
    ],
  });
  const [amountOut, sqrtPriceX96After, , gasEstimate] = simulated.result;
  return {
    amountOut: formatUnits(amountOut, toToken.decimals),
    amountOutRaw: amountOut.toString(),
    gasEstimate: gasEstimate.toString(),
    sqrtPriceX96After: sqrtPriceX96After.toString(),
    fee: feeTier,
  };
}

export async function quoteBestV3(fromToken: SwapToken, toToken: SwapToken, amountIn: bigint): Promise<SwapQuoteSet> {
  const allQuotes = await Promise.all(
    FEE_TIERS.map(async (fee) => {
      try {
        return { ok: true as const, ...(await withTimeout(quoteV3(fromToken, toToken, amountIn, fee), 8_000)) };
      } catch (error) {
        return { ok: false as const, fee, error: error instanceof Error ? error.message : "quote_failed" };
      }
    }),
  );
  const bestQuote =
    allQuotes
      .filter((quote): quote is Extract<(typeof allQuotes)[number], { ok: true }> => quote.ok)
      .sort((a, b) => {
        const left = BigInt(a.amountOutRaw);
        const right = BigInt(b.amountOutRaw);
        return left > right ? -1 : left < right ? 1 : 0;
      })[0] ?? null;

  return { bestQuote, allQuotes };
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number) {
  return Promise.race([
    promise,
    new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error("quote_timeout")), timeoutMs);
    }),
  ]);
}
