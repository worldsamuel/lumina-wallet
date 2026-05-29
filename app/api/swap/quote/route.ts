import { NextRequest } from "next/server";
import { formatUnits, isAddress, parseUnits, zeroAddress, type Address } from "viem";
import { jsonResponse, optionsResponse } from "@/lib/api/cors";
import { rateLimit } from "@/lib/api/rate-limit";
import { publicClient } from "@/lib/chain";
import { TOKENS } from "@/lib/tokens";

const UNISWAP_V3_FACTORY = "0x7a5028BDa40e7B173C278C5342087826455ea25a" as Address;
const UNISWAP_V3_QUOTER_V2 = "0x10158D43e6cc414deE1Bd1eB0EfC6a5cBCfF244c" as Address;
const WORLD_CHAIN_WETH = "0x4200000000000000000000000000000000000006" as Address;
const BUNGEE_NATIVE_TOKEN = "0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee";
const BUNGEE_QUOTE_URL = "https://public-backend.bungee.exchange/api/v1/bungee/quote";
const QUOTE_USER = "0x0000000000000000000000000000000000000001";
const FEE_TIERS = [100, 500, 3000, 10000] as const;
const DEFAULT_SLIPPAGE_BPS = 50n;

const factoryAbi = [
  {
    type: "function",
    name: "getPool",
    stateMutability: "view",
    inputs: [
      { name: "tokenA", type: "address" },
      { name: "tokenB", type: "address" },
      { name: "fee", type: "uint24" },
    ],
    outputs: [{ name: "pool", type: "address" }],
  },
] as const;

const poolAbi = [
  {
    type: "function",
    name: "slot0",
    stateMutability: "view",
    inputs: [],
    outputs: [
      { name: "sqrtPriceX96", type: "uint160" },
      { name: "tick", type: "int24" },
      { name: "observationIndex", type: "uint16" },
      { name: "observationCardinality", type: "uint16" },
      { name: "observationCardinalityNext", type: "uint16" },
      { name: "feeProtocol", type: "uint8" },
      { name: "unlocked", type: "bool" },
    ],
  },
  {
    type: "function",
    name: "token0",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "address" }],
  },
] as const;

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

type QuoteBody = {
  fromToken?: string;
  toToken?: string;
  fromAmount?: string;
  slippageBps?: number;
};

export function OPTIONS() {
  return optionsResponse();
}

export async function POST(req: NextRequest) {
  if (!rateLimit(req, "public:swap-quote", 120).ok) {
    return jsonResponse({ error: "Too many requests." }, { status: 429 });
  }

  const body = (await req.json().catch(() => null)) as QuoteBody | null;
  const from = resolveToken(body?.fromToken);
  const to = resolveToken(body?.toToken);
  if (!from || !to) return jsonResponse({ error: "Unsupported token." }, { status: 400 });
  if (from.address.toLowerCase() === to.address.toLowerCase()) {
    return jsonResponse({ error: "Choose two different tokens." }, { status: 400 });
  }

  const amountText = String(body?.fromAmount ?? "").replace(/,/g, "").trim();
  if (!amountText || Number(amountText) <= 0) {
    return jsonResponse({ error: "Enter a valid amount." }, { status: 400 });
  }

  let amountIn: bigint;
  try {
    amountIn = parseUnits(amountText, from.decimals);
  } catch {
    return jsonResponse({ error: "Invalid token amount." }, { status: 400 });
  }

  const quotes = await Promise.all(
    FEE_TIERS.map((fee) => withTimeout(quotePool(from, to, amountIn, fee), 3500).catch(() => null)),
  );
  const best = quotes
    .filter((quote): quote is NonNullable<typeof quote> => Boolean(quote))
    .sort((a, b) => (a.amountOut > b.amountOut ? -1 : a.amountOut < b.amountOut ? 1 : 0))[0];

  if (!best) {
    const bungee = await quoteBungee(from, to, amountIn, slippageBpsFromBody(body?.slippageBps)).catch((error) => {
      console.error("Bungee quote failed", error);
      return null;
    });
    if (bungee) return jsonResponse(bungee);
    return jsonResponse({ error: "No Uniswap v3 or Bungee quote found for this pair on World Chain." }, { status: 404 });
  }

  const slippageBps = slippageBpsFromBody(body?.slippageBps);
  const minAmountOut = (best.amountOut * (10_000n - slippageBps)) / 10_000n;

  return jsonResponse({
    dex: "Uniswap V3",
    fromToken: from.symbol,
    toToken: to.symbol,
    fromAmount: amountText,
    toAmount: formatUnits(best.amountOut, to.decimals),
    minToAmount: formatUnits(minAmountOut, to.decimals),
    priceImpact: best.priceImpact,
    route: [`${from.symbol}/${to.symbol} ${best.fee / 10000}%`],
    gas: best.gasEstimate.toString(),
    gasLabel: `~${best.gasEstimate.toLocaleString()} gas`,
    pool: best.pool,
    fee: best.fee,
    note: "Read-only quote. No swap transaction, approve flow, or MiniKit.sendTransaction is executed.",
  });
}

function slippageBpsFromBody(value: unknown) {
  return typeof value === "number" && value >= 0 && value <= 500
    ? BigInt(Math.round(value))
    : DEFAULT_SLIPPAGE_BPS;
}

function resolveToken(value?: string) {
  const key = String(value ?? "").trim();
  if (!key) return null;
  if (key.toUpperCase() === "ETH") {
    return { symbol: "ETH", decimals: 18, address: WORLD_CHAIN_WETH };
  }
  if (isAddress(key)) {
    return null;
  }
  const token = TOKENS.find((item) => item.symbol.toUpperCase() === key.toUpperCase());
  if (!token?.contractAddress) return null;
  return {
    symbol: token.symbol,
    decimals: token.decimals,
    address: token.contractAddress,
  };
}

function bungeeTokenAddress(token: { symbol: string; address: Address }) {
  return token.symbol === "ETH" ? BUNGEE_NATIVE_TOKEN : token.address;
}

type BungeeQuoteResponse = {
  success?: boolean;
  result?: {
    autoRoute?: BungeeRoute | null;
    manualRoutes?: BungeeRoute[];
  };
  message?: string | null;
};

type BungeeRoute = {
  output?: {
    amount?: string;
    minAmountOut?: string;
  };
  gasFee?: {
    gasLimit?: string;
    gasPrice?: string;
    estimatedFee?: string;
    feeInUsd?: number;
  } | null;
  routeDetails?: {
    name?: string;
  };
};

async function quoteBungee(
  from: { symbol: string; decimals: number; address: Address },
  to: { symbol: string; decimals: number; address: Address },
  amountIn: bigint,
  slippageBps: bigint,
) {
  const params = new URLSearchParams({
    originChainId: "480",
    destinationChainId: "480",
    inputToken: bungeeTokenAddress(from),
    outputToken: bungeeTokenAddress(to),
    inputAmount: amountIn.toString(),
    receiverAddress: QUOTE_USER,
    userAddress: QUOTE_USER,
    slippage: (Number(slippageBps) / 100).toString(),
    enableManual: "true",
    disableAuto: "true",
  });

  const response = await fetch(`${BUNGEE_QUOTE_URL}?${params}`, {
    headers: { accept: "application/json" },
    next: { revalidate: 10 },
  });
  if (!response.ok) throw new Error(`Bungee responded ${response.status}`);
  const body = (await response.json()) as BungeeQuoteResponse;
  const route = body.result?.manualRoutes?.[0] ?? body.result?.autoRoute;
  const amountOut = route?.output?.amount;
  if (!amountOut) return null;

  const gasLimit = route.gasFee?.gasLimit ?? "0";

  return {
    dex: "Bungee",
    fromToken: from.symbol,
    toToken: to.symbol,
    fromAmount: formatUnits(amountIn, from.decimals),
    toAmount: formatUnits(BigInt(amountOut), to.decimals),
    minToAmount: route.output?.minAmountOut ? formatUnits(BigInt(route.output.minAmountOut), to.decimals) : null,
    priceImpact: null,
    route: [route.routeDetails?.name ? `Bungee · ${route.routeDetails.name}` : "Bungee"],
    gas: gasLimit,
    gasLabel: gasLimit !== "0" ? `~${Number(gasLimit).toLocaleString()} gas` : "—",
    gasFeeWei: route.gasFee?.estimatedFee ?? null,
    gasFeeUsd: route.gasFee?.feeInUsd ?? null,
    note: "Read-only quote. Bungee txData/approvalData is intentionally ignored; no transaction is executed.",
  };
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number) {
  return Promise.race([
    promise,
    new Promise<null>((resolve) => {
      setTimeout(() => resolve(null), timeoutMs);
    }),
  ]);
}

async function quotePool(
  from: { symbol: string; decimals: number; address: Address },
  to: { symbol: string; decimals: number; address: Address },
  amountIn: bigint,
  fee: (typeof FEE_TIERS)[number],
) {
  const pool = await publicClient.readContract({
    address: UNISWAP_V3_FACTORY,
    abi: factoryAbi,
    functionName: "getPool",
    args: [from.address, to.address, fee],
  });
  if (pool === zeroAddress) return null;

  const [token0, slot0, simulated] = await Promise.all([
    publicClient.readContract({ address: pool, abi: poolAbi, functionName: "token0" }),
    publicClient.readContract({ address: pool, abi: poolAbi, functionName: "slot0" }),
    publicClient.simulateContract({
      account: zeroAddress,
      address: UNISWAP_V3_QUOTER_V2,
      abi: quoterV2Abi,
      functionName: "quoteExactInputSingle",
      args: [
        {
          tokenIn: from.address,
          tokenOut: to.address,
          amountIn,
          fee,
          sqrtPriceLimitX96: 0n,
        },
      ],
    }),
  ]);

  const [amountOut, sqrtPriceX96After, , gasEstimate] = simulated.result;
  const currentPrice = priceFromSqrt(slot0[0], token0, from, to);
  const nextPrice = priceFromSqrt(sqrtPriceX96After, token0, from, to);
  const priceImpact = currentPrice > 0 ? Math.abs((nextPrice - currentPrice) / currentPrice) * 100 : 0;

  return {
    pool,
    fee,
    amountOut,
    gasEstimate,
    priceImpact: Number.isFinite(priceImpact) ? Number(priceImpact.toFixed(4)) : 0,
  };
}

function priceFromSqrt(
  sqrtPriceX96: bigint,
  token0: Address,
  from: { decimals: number; address: Address },
  to: { decimals: number; address: Address },
) {
  const sqrt = Number(sqrtPriceX96) / 2 ** 96;
  const token1PerToken0 = sqrt * sqrt;
  if (token0.toLowerCase() === from.address.toLowerCase()) {
    return token1PerToken0 * 10 ** (from.decimals - to.decimals);
  }
  return 1 / (token1PerToken0 * 10 ** (to.decimals - from.decimals));
}
