import { encodePacked, formatUnits, type Address } from "viem";
import { publicClient } from "@/lib/chain";
import type { SwapQuoteResult, SwapQuoteSet } from "./quote-types";
import { SWAP_TOKENS, type SwapToken } from "./tokens";

const UNISWAP_V3_QUOTER_V2 = "0x10158D43e6cc414deE1Bd1eB0EfC6a5cBCfF244c" as Address;
const FEE_TIERS = [500, 3000, 10000] as const;
const COMMON_TWO_HOP_FEES = [
  [3000, 3000],
  [10000, 3000],
  [3000, 10000],
  [500, 3000],
  [3000, 500],
] as const;

type V3RouteCandidate = { tokens: SwapToken[]; fees: number[] };

declare global {
  // eslint-disable-next-line no-var
  var __luminaV3BestRouteCache: Map<string, { expiresAt: number; route: V3RouteCandidate }> | undefined;
}

const bestRouteCache = globalThis.__luminaV3BestRouteCache ?? new Map<string, { expiresAt: number; route: V3RouteCandidate }>();
globalThis.__luminaV3BestRouteCache = bestRouteCache;

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
  const cacheKey = routeCacheKey(fromToken, toToken);
  const routes = orderRouteCandidates(buildRouteCandidates(fromToken, toToken), bestRouteCache.get(cacheKey));
  const priorityCount = Math.min(routes.length, 18);
  const priorityQuotes = await quoteRoutes(routes.slice(0, priorityCount), fromToken, toToken, amountIn);
  let allQuotes = priorityQuotes;
  let bestQuote = pickBestQuote(allQuotes);

  if (!bestQuote && routes.length > priorityCount) {
    const fallbackQuotes = await quoteRoutes(routes.slice(priorityCount), fromToken, toToken, amountIn);
    allQuotes = [...priorityQuotes, ...fallbackQuotes];
    bestQuote = pickBestQuote(allQuotes);
  }
  if (bestQuote?.route) {
    const bestRoute = routes.find((route) => routeSignature(route) === routeSignatureFromQuote(bestQuote));
    if (bestRoute) bestRouteCache.set(cacheKey, { route: bestRoute, expiresAt: Date.now() + 10 * 60_000 });
  }
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

async function quoteRoutes(routes: V3RouteCandidate[], fromToken: SwapToken, toToken: SwapToken, amountIn: bigint) {
  return Promise.all(
    routes.map(async (route) => {
      try {
        const quote =
          route.tokens.length === 2
            ? await withTimeout(quoteV3(fromToken, toToken, amountIn, route.fees[0] as (typeof FEE_TIERS)[number]), 2_500)
            : await withTimeout(quoteV3Path(route.tokens, route.fees, amountIn, toToken.decimals), 2_500);
        return { ok: true as const, ...quote };
      } catch (error) {
        return { ok: false as const, fee: route.fees[0] ?? 0, error: error instanceof Error ? error.message : "quote_failed" };
      }
    }),
  );
}

function pickBestQuote(quotes: Awaited<ReturnType<typeof quoteRoutes>>) {
  return (
    quotes
      .filter((quote): quote is Extract<(typeof quotes)[number], { ok: true }> => quote.ok)
      .sort((a, b) => {
        const left = BigInt(a.amountOutRaw);
        const right = BigInt(b.amountOutRaw);
        return left > right ? -1 : left < right ? 1 : 0;
      })[0] ?? null
  );
}

function buildRouteCandidates(fromToken: SwapToken, toToken: SwapToken) {
  const routes: V3RouteCandidate[] = [];
  for (const fee of FEE_TIERS) routes.push({ tokens: [fromToken, toToken], fees: [fee] });

  const intermediates = [SWAP_TOKENS.USDC, SWAP_TOKENS.WLD, SWAP_TOKENS.WETH].filter(
    (token, index, list) =>
      token.address.toLowerCase() !== fromToken.address.toLowerCase() &&
      token.address.toLowerCase() !== toToken.address.toLowerCase() &&
      list.findIndex((item) => item.address.toLowerCase() === token.address.toLowerCase()) === index,
  );
  for (const mid of intermediates) {
    for (const fees of COMMON_TWO_HOP_FEES) {
      routes.push({ tokens: [fromToken, mid, toToken], fees: [...fees] });
    }
    for (const firstFee of FEE_TIERS) {
      for (const secondFee of FEE_TIERS) routes.push({ tokens: [fromToken, mid, toToken], fees: [firstFee, secondFee] });
    }
  }
  return dedupeRoutes(routes);
}

function dedupeRoutes(routes: V3RouteCandidate[]) {
  const seen = new Set<string>();
  return routes.filter((route) => {
    const key = routeSignature(route);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function orderRouteCandidates(routes: V3RouteCandidate[], cached?: { expiresAt: number; route: V3RouteCandidate }) {
  if (!cached || cached.expiresAt <= Date.now()) return routes;
  const cachedSig = routeSignature(cached.route);
  return [...routes].sort((a, b) => {
    if (routeSignature(a) === cachedSig) return -1;
    if (routeSignature(b) === cachedSig) return 1;
    return 0;
  });
}

function routeCacheKey(fromToken: SwapToken, toToken: SwapToken) {
  return `${fromToken.address.toLowerCase()}:${toToken.address.toLowerCase()}`;
}

function routeSignature(route: V3RouteCandidate) {
  return `${route.tokens.map((token) => token.address.toLowerCase()).join(">")}|${route.fees.join(">")}`;
}

function routeSignatureFromQuote(quote: SwapQuoteResult) {
  return `${(quote.route?.tokens ?? []).map((token) => token.toLowerCase()).join(">")}|${(quote.route?.fees ?? [quote.fee]).join(">")}`;
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
