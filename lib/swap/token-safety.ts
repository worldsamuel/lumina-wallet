import { formatUnits, isAddress, parseUnits, zeroAddress, type Address } from "viem";
import { publicClient } from "@/lib/chain";
import { quoteV3 } from "./v3-quoter";
import { resolveCoreSwapToken, SWAP_TOKENS, VERIFIED_SWAP_TOKENS, type SwapToken } from "./tokens";

const UNISWAP_V3_FACTORY = "0x7a5028BDa40e7B173C278C5342087826455ea25a" as Address;
const FEE_TIERS = [500, 3000, 10000] as const;
const REFERENCE_SYMBOLS = ["USDC", "WLD", "WETH"] as const;
const MIN_TVL_USD = 100;
const LOW_TVL_USD = 5_000;
const MAX_CACHE_AGE_MS = 5 * 60 * 1000;

declare global {
  // eslint-disable-next-line no-var
  var __luminaSwapTokenSafetyCache: Map<string, { expiresAt: number; data: TokenSafetyReport }> | undefined;
}

const erc20Abi = [
  { type: "function", name: "name", stateMutability: "view", inputs: [], outputs: [{ type: "string" }] },
  { type: "function", name: "symbol", stateMutability: "view", inputs: [], outputs: [{ type: "string" }] },
  { type: "function", name: "decimals", stateMutability: "view", inputs: [], outputs: [{ type: "uint8" }] },
  { type: "function", name: "balanceOf", stateMutability: "view", inputs: [{ type: "address" }], outputs: [{ type: "uint256" }] },
] as const;

const factoryAbi = [
  {
    type: "function",
    name: "getPool",
    stateMutability: "view",
    inputs: [
      { type: "address", name: "tokenA" },
      { type: "address", name: "tokenB" },
      { type: "uint24", name: "fee" },
    ],
    outputs: [{ type: "address", name: "pool" }],
  },
] as const;

export type TokenSafetyReport = {
  status: "verified" | "community" | "rejected";
  reasons: string[];
  metadata: { address: Address; name: string; symbol: string; decimals: number; logo?: string };
  liquidity: { tvlUsd: number; pools: Array<{ address: Address; pair: string; fee: number; tvlUsd: number }> };
  safety: {
    hasMetadata: boolean;
    hasLiquidity: boolean;
    passedHoneypot: boolean;
    transferFee: number;
    ageInDays: number | null;
    blacklisted: boolean;
    sellbackRatio: number | null;
  };
};

const cache = globalThis.__luminaSwapTokenSafetyCache ?? new Map<string, { expiresAt: number; data: TokenSafetyReport }>();
globalThis.__luminaSwapTokenSafetyCache = cache;

const BLACKLIST = new Set<string>([]);

export async function checkSwapTokenSafety(input: string): Promise<TokenSafetyReport> {
  if (!isAddress(input)) throw new Error("Invalid token contract");
  const address = input as Address;
  const lower = address.toLowerCase();
  const cached = cache.get(lower);
  if (cached && cached.expiresAt > Date.now()) return cached.data;

  const core = Object.values(SWAP_TOKENS).find((token) => token.address.toLowerCase() === lower);
  if (core) {
    const report = verifiedReport(core, "verified");
    cache.set(lower, { data: report, expiresAt: Date.now() + MAX_CACHE_AGE_MS });
    return report;
  }

  const audited = Object.values(VERIFIED_SWAP_TOKENS).find((token) => token.address.toLowerCase() === lower);
  if (audited) {
    const report = verifiedReport(audited, "verified");
    cache.set(lower, { data: report, expiresAt: Date.now() + MAX_CACHE_AGE_MS });
    return report;
  }

  const metadata = await readMetadata(address);
  const reasons: string[] = [];
  if (BLACKLIST.has(lower)) reasons.push("blacklisted");

  const token: SwapToken = {
    address,
    symbol: metadata.symbol,
    name: metadata.name,
    decimals: metadata.decimals,
    priceSymbol: "USDC",
    trust: "community",
  };

  const liquidity = await inspectLiquidity(token);
  if (liquidity.tvlUsd < MIN_TVL_USD) reasons.push("low_liquidity");
  else if (liquidity.tvlUsd < LOW_TVL_USD) reasons.push("low_liquidity_warning");

  const sellback = await inspectSellback(token, liquidity.pools);
  if (sellback.ratio === null) reasons.push("honeypot_check_failed");
  else if (sellback.ratio < 0.5) reasons.push("honeypot");
  else if (sellback.ratio < 0.9) reasons.push("high_sellback_impact");

  const status = reasons.some((reason) => ["blacklisted", "low_liquidity", "honeypot", "honeypot_check_failed"].includes(reason))
    ? "rejected"
    : "community";

  const report: TokenSafetyReport = {
    status,
    reasons,
    metadata,
    liquidity,
    safety: {
      hasMetadata: true,
      hasLiquidity: liquidity.tvlUsd >= MIN_TVL_USD,
      passedHoneypot: sellback.ratio !== null && sellback.ratio >= 0.5,
      transferFee: sellback.transferFee,
      ageInDays: null,
      blacklisted: BLACKLIST.has(lower),
      sellbackRatio: sellback.ratio,
    },
  };
  cache.set(lower, { data: report, expiresAt: Date.now() + MAX_CACHE_AGE_MS });
  return report;
}

export async function resolveSafeSwapToken(value: unknown): Promise<SwapToken | null> {
  const core = resolveCoreSwapToken(value);
  if (core) return core;
  const text = String(value ?? "").trim();
  if (!isAddress(text)) return null;
  const report = await checkSwapTokenSafety(text);
  if (report.status === "rejected") return null;
  return {
    symbol: report.metadata.symbol,
    name: report.metadata.name,
    address: report.metadata.address,
    decimals: report.metadata.decimals,
    priceSymbol: "USDC",
    trust: report.status === "verified" ? "audited" : "community",
    safety: report,
  };
}

function verifiedReport(token: SwapToken, status: "verified" | "community"): TokenSafetyReport {
  return {
    status,
    reasons: [],
    metadata: { address: token.address, name: token.name, symbol: token.symbol, decimals: token.decimals },
    liquidity: { tvlUsd: 0, pools: [] },
    safety: {
      hasMetadata: true,
      hasLiquidity: true,
      passedHoneypot: true,
      transferFee: 0,
      ageInDays: null,
      blacklisted: false,
      sellbackRatio: 1,
    },
  };
}

async function readMetadata(address: Address) {
  try {
    const [name, symbol, decimals] = await Promise.all([
      publicClient.readContract({ address, abi: erc20Abi, functionName: "name" }),
      publicClient.readContract({ address, abi: erc20Abi, functionName: "symbol" }),
      publicClient.readContract({ address, abi: erc20Abi, functionName: "decimals" }),
    ]);
    const cleanSymbol = String(symbol || "").trim().slice(0, 24);
    const cleanName = String(name || cleanSymbol).trim().slice(0, 80);
    const cleanDecimals = Number(decimals);
    if (!cleanSymbol || !Number.isInteger(cleanDecimals) || cleanDecimals < 0 || cleanDecimals > 18) {
      throw new Error("Invalid token metadata");
    }
    return { address, name: cleanName || cleanSymbol, symbol: cleanSymbol, decimals: cleanDecimals };
  } catch {
    throw new Error("Invalid token contract");
  }
}

async function inspectLiquidity(token: SwapToken) {
  type PoolLiquidity = { address: Address; pair: string; fee: number; tvlUsd: number };
  const poolResults = await Promise.all(
      REFERENCE_SYMBOLS.flatMap((symbol) =>
        FEE_TIERS.map(async (fee): Promise<PoolLiquidity | null> => {
          const ref = SWAP_TOKENS[symbol];
          const pool = await publicClient.readContract({
            address: UNISWAP_V3_FACTORY,
            abi: factoryAbi,
            functionName: "getPool",
            args: [token.address, ref.address, fee],
          });
          if (!pool || pool === zeroAddress) return null;
          const refBalance = await publicClient
            .readContract({ address: ref.address, abi: erc20Abi, functionName: "balanceOf", args: [pool] })
            .catch(() => 0n);
          const refUsd = referenceUsd(ref.symbol);
          const tvlUsd = Number(formatUnits(refBalance, ref.decimals)) * refUsd * 2;
          return { address: pool, pair: `${token.symbol}/${ref.symbol}`, fee, tvlUsd };
        }),
      ),
    );
  const pools: PoolLiquidity[] = poolResults.filter((pool): pool is PoolLiquidity => Boolean(pool));

  return {
    tvlUsd: pools.reduce((sum, pool) => Math.max(sum, pool.tvlUsd), 0),
    pools: pools.sort((a, b) => b.tvlUsd - a.tvlUsd),
  };
}

async function inspectSellback(token: SwapToken, pools: Array<{ pair: string; fee: number }>) {
  const attempts: Array<{ ratio: number; transferFee: number }> = [];
  for (const pool of pools.slice(0, 1)) {
    const symbol = String(pool.pair).split("/")[1] as (typeof REFERENCE_SYMBOLS)[number];
    if (!REFERENCE_SYMBOLS.includes(symbol)) continue;
    const ref = SWAP_TOKENS[symbol];
    try {
      const amountIn = parseUnits(symbol === "WETH" ? "0.001" : "1", ref.decimals);
      const fee = pool.fee as 500 | 3000 | 10000;
      const buy = await withTimeout(quoteV3(ref, token, amountIn, fee), 3_000);
      if (BigInt(buy.amountOutRaw) <= 0n) continue;
      const sell = await withTimeout(quoteV3(token, ref, BigInt(buy.amountOutRaw), fee), 3_000);
      if (BigInt(sell.amountOutRaw) <= 0n) continue;
      const ratio = Number(formatUnits(BigInt(sell.amountOutRaw), ref.decimals)) / Number(formatUnits(amountIn, ref.decimals));
      attempts.push({ ratio, transferFee: Math.max(0, (1 - ratio) * 100) });
    } catch {
      continue;
    }
  }
  if (attempts.length) return attempts.sort((a, b) => b.ratio - a.ratio)[0];
  return { ratio: null, transferFee: 100 };
}

function referenceUsd(symbol: string) {
  if (symbol === "USDC" || symbol === "EURC") return 1;
  if (symbol === "WLD") return 1.5;
  if (symbol === "WETH" || symbol === "ETH") return 3800;
  if (symbol === "WBTC") return 105000;
  return 0;
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number) {
  return Promise.race([
    promise,
    new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error("safety_timeout")), timeoutMs);
    }),
  ]);
}
