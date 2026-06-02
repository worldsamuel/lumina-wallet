import { encodePacked, formatUnits, type Address } from "viem";
import { publicClient } from "@/lib/chain";
import type { SwapQuoteResult, SwapQuoteSet } from "./quote-types";
import { SWAP_TOKENS, type SwapToken } from "./tokens";

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
  {
    type: "function",
    name: "quoteExactInput",
    stateMutability: "nonpayable",
    inputs: [
      { name: "path", type: "bytes" },
      { name: "amountIn", type: "uint256" },
    ],
    outputs: [
      { name: "amountOut", type: "uint256" },
      { name: "sqrtPriceX96AfterList", type: "uint160[]" },
      { name: "initializedTicksCrossedList", type: "uint32[]" },
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
  const routes = buildRouteCandidates(fromToken, toToken);
  const allQuotes = await Promise.all(
    routes.map(async (route) => {
      try {
        const quote =
          route.tokens.length === 2
            ? await withTimeout(quoteV3(fromToken, toToken, amountIn, route.fees[0] as (typeof FEE_TIERS)[number]), 4_000)
            : await withTimeout(quoteV3Path(route.tokens, route.fees, amountIn, toToken.decimals), 4_000);
        return { ok: true as const, ...quote };
      } catch (error) {
        return { ok: false as const, fee: route.fees[0] ?? 0, error: error instanceof Error ? error.message : "quote_failed" };
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

async function quoteV3Path(tokens: SwapToken[], fees: number[], amountIn: bigint, outDecimals: number): Promise<SwapQuoteResult> {
  const simulated = await publicClient.simulateContract({
    address: UNISWAP_V3_QUOTER_V2,
    abi: quoterV2Abi,
    functionName: "quoteExactInput",
    args: [encodeV3Path(tokens, fees), amountIn],
  });
  const [amountOut, , , gasEstimate] = simulated.result;
  return {
    amountOut: formatUnits(amountOut, outDecimals),
    amountOutRaw: amountOut.toString(),
    gasEstimate: gasEstimate.toString(),
    fee: fees[0] ?? 0,
    route: {
      tokens: tokens.map((token) => token.address),
      fees,
    },
  };
}

function buildRouteCandidates(fromToken: SwapToken, toToken: SwapToken) {
  const routes: Array<{ tokens: SwapToken[]; fees: number[] }> = [];
  for (const fee of FEE_TIERS) routes.push({ tokens: [fromToken, toToken], fees: [fee] });

  const intermediates = [SWAP_TOKENS.USDC, SWAP_TOKENS.WLD, SWAP_TOKENS.WETH].filter(
    (token, index, list) =>
      token.address.toLowerCase() !== fromToken.address.toLowerCase() &&
      token.address.toLowerCase() !== toToken.address.toLowerCase() &&
      list.findIndex((item) => item.address.toLowerCase() === token.address.toLowerCase()) === index,
  );
  for (const mid of intermediates) {
    for (const firstFee of FEE_TIERS) {
      for (const secondFee of FEE_TIERS) {
        routes.push({ tokens: [fromToken, mid, toToken], fees: [firstFee, secondFee] });
      }
    }
  }
  return routes;
}

function encodeV3Path(tokens: SwapToken[], fees: number[]) {
  const types: Array<"address" | "uint24"> = [];
  const values: Array<Address | number> = [];
  tokens.forEach((token, index) => {
    types.push("address");
    values.push(token.address);
    if (index < fees.length) {
      types.push("uint24");
      values.push(fees[index]);
    }
  });
  return encodePacked(types, values);
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number) {
  return Promise.race([
    promise,
    new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error("quote_timeout")), timeoutMs);
    }),
  ]);
}
