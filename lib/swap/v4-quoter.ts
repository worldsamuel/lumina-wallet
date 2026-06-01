import { formatUnits, zeroAddress, type Address } from "viem";
import { publicClient } from "@/lib/chain";
import type { SwapQuoteResult, SwapQuoteSet } from "./quote-types";
import type { SwapToken } from "./tokens";

const UNISWAP_V4_QUOTER = "0x55d235b3ff2daf7c3ede0defc9521f1d6fe6c5c0" as Address;
const FEE_TIERS = [500, 3000, 10000] as const;
const TICK_SPACING_BY_FEE: Record<(typeof FEE_TIERS)[number], number> = {
  500: 10,
  3000: 60,
  10000: 200,
};

const v4QuoterAbi = [
  {
    type: "function",
    name: "quoteExactInputSingle",
    stateMutability: "nonpayable",
    inputs: [
      {
        name: "params",
        type: "tuple",
        components: [
          {
            name: "poolKey",
            type: "tuple",
            components: [
              { name: "currency0", type: "address" },
              { name: "currency1", type: "address" },
              { name: "fee", type: "uint24" },
              { name: "tickSpacing", type: "int24" },
              { name: "hooks", type: "address" },
            ],
          },
          { name: "zeroForOne", type: "bool" },
          { name: "exactAmount", type: "uint128" },
          { name: "hookData", type: "bytes" },
        ],
      },
    ],
    outputs: [
      { name: "amountOut", type: "uint256" },
      { name: "gasEstimate", type: "uint256" },
    ],
  },
] as const;

export async function quoteV4(
  fromToken: SwapToken,
  toToken: SwapToken,
  amountIn: bigint,
  feeTier: (typeof FEE_TIERS)[number],
): Promise<SwapQuoteResult> {
  const [currency0, currency1] = sortCurrencies(fromToken.address, toToken.address);
  const simulated = await publicClient.simulateContract({
    address: UNISWAP_V4_QUOTER,
    abi: v4QuoterAbi,
    functionName: "quoteExactInputSingle",
    args: [
      {
        poolKey: {
          currency0,
          currency1,
          fee: feeTier,
          tickSpacing: TICK_SPACING_BY_FEE[feeTier],
          hooks: zeroAddress,
        },
        zeroForOne: fromToken.address.toLowerCase() === currency0.toLowerCase(),
        exactAmount: amountIn,
        hookData: "0x",
      },
    ],
  });
  const [amountOut, gasEstimate] = simulated.result;
  return {
    amountOut: formatUnits(amountOut, toToken.decimals),
    amountOutRaw: amountOut.toString(),
    gasEstimate: gasEstimate.toString(),
    fee: feeTier,
  };
}

export async function quoteBestV4(fromToken: SwapToken, toToken: SwapToken, amountIn: bigint): Promise<SwapQuoteSet> {
  const allQuotes = await Promise.all(
    FEE_TIERS.map(async (fee) => {
      try {
        return { ok: true as const, ...(await withTimeout(quoteV4(fromToken, toToken, amountIn, fee), 4_000)) };
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

function sortCurrencies(a: Address, b: Address): [Address, Address] {
  return BigInt(a) < BigInt(b) ? [a, b] : [b, a];
}
