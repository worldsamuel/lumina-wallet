import { formatUnits, type Address } from "viem";
import { WORLD_CHAIN_ID } from "./contracts";
import type { SwapQuoteResult, SwapQuoteSet } from "./quote-types";
import type { SwapToken } from "./tokens";

const UNISWAP_TRADING_API_URL =
  process.env.UNISWAP_TRADING_API_URL ?? "https://trading-api-labs.interface.gateway.uniswap.org/v1/quote";

type UniswapApiQuoteInput = {
  fromToken: SwapToken;
  toToken: SwapToken;
  amountIn: bigint;
  slippageBps: number;
  swapper?: Address | null;
};

type UniswapApiPoolLeg = {
  type?: string;
  tokenIn?: { address?: string; symbol?: string; decimals?: string | number };
  tokenOut?: { address?: string; symbol?: string; decimals?: string | number };
  fee?: string | number;
  amountOut?: string;
};

type UniswapApiQuoteResponse = {
  routing?: string;
  quote?: {
    route?: UniswapApiPoolLeg[][];
    output?: {
      amount?: string;
      minimumAmount?: string;
    };
    priceImpact?: number;
    gasUseEstimate?: string;
    gasFeeUSD?: string;
    quoteId?: string;
  };
};

export async function quoteBestUniswapApi(input: UniswapApiQuoteInput): Promise<SwapQuoteSet & { apiRouting?: string; apiQuoteId?: string }> {
  const apiKey = process.env.UNISWAP_API_KEY || process.env.UNISWAP_API_KEY_SERVER;
  if (!apiKey || !input.swapper) return { bestQuote: null, allQuotes: [] };

  const response = await fetch(UNISWAP_TRADING_API_URL, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": apiKey,
    },
    cache: "no-store",
    body: JSON.stringify({
      type: "EXACT_INPUT",
      tokenInChainId: WORLD_CHAIN_ID,
      tokenOutChainId: WORLD_CHAIN_ID,
      tokenIn: input.fromToken.address,
      tokenOut: input.toToken.address,
      amount: input.amountIn.toString(),
      swapper: input.swapper,
      slippageTolerance: input.slippageBps / 100,
    }),
  });

  const data = (await response.json().catch(() => null)) as UniswapApiQuoteResponse | { detail?: string; errorCode?: string } | null;
  if (!response.ok) throw new Error((data && "detail" in data && data.detail) || (data && "errorCode" in data && data.errorCode) || "uniswap_api_quote_failed");

  const parsed = parseClassicRoute(data as UniswapApiQuoteResponse, input.toToken.decimals);
  return {
    bestQuote: parsed,
    allQuotes: parsed ? [{ ok: true as const, ...parsed }] : [],
    apiRouting: (data as UniswapApiQuoteResponse).routing,
    apiQuoteId: (data as UniswapApiQuoteResponse).quote?.quoteId,
  };
}

function parseClassicRoute(data: UniswapApiQuoteResponse, outDecimals: number): SwapQuoteResult | null {
  const quote = data.quote;
  const amountOutRaw = quote?.output?.amount;
  const paths = quote?.route;
  if (!amountOutRaw || !paths?.length) return null;

  // The current World App execution path builds one Universal Router V3 path.
  // Split routes or V4 legs need the Trading API /swap calldata flow.
  if (paths.length !== 1) return null;
  const path = paths[0];
  if (!path.length || path.some((leg) => leg.type !== "v3-pool")) return null;

  const first = path[0]?.tokenIn?.address;
  if (!first) return null;
  const tokens = [first, ...path.map((leg) => leg.tokenOut?.address).filter((address): address is string => Boolean(address))];
  const fees = path.map((leg) => Number(leg.fee));
  if (tokens.length !== fees.length + 1 || fees.some((fee) => !Number.isInteger(fee) || fee <= 0)) return null;

  return {
    amountOut: formatUnits(BigInt(amountOutRaw), outDecimals),
    amountOutRaw,
    gasEstimate: quote?.gasUseEstimate ?? "0",
    gasEstimateUsd: Number(quote?.gasFeeUSD ?? 0) || null,
    priceImpactPercent: typeof quote?.priceImpact === "number" ? quote.priceImpact : null,
    provider: "uniswap-api",
    fee: fees[0],
    route: {
      tokens,
      fees,
    },
  };
}
