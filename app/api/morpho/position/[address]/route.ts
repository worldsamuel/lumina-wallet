import { NextRequest } from "next/server";
import { formatUnits, isAddress, type Address } from "viem";
import { jsonResponse, optionsResponse } from "@/lib/api/cors";
import { rateLimit } from "@/lib/api/rate-limit";
import { readWorldChainWithFallback } from "@/lib/chain";
import { getEnabledEarnVaults } from "@/lib/admin/earn-products";
import { ERC20_APPROVE_ABI, METAMORPHO_ABI } from "@/lib/morpho/abi";

const vaultMetaAbi = [
  {
    type: "function",
    name: "decimals",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint8" }],
  },
  {
    type: "function",
    name: "symbol",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "string" }],
  },
] as const;

export const dynamic = "force-dynamic";
const NO_STORE_HEADERS = {
  "Cache-Control": "private, no-store, no-cache, must-revalidate, max-age=0",
  Pragma: "no-cache",
  Expires: "0",
};
const POSITION_CACHE_TTL_MS = 2_000;
const POSITION_STALE_TTL_MS = 10 * 60_000;
type PositionResponse = {
  address: string;
  positions: Array<Record<string, unknown>>;
  updatedAt: string;
  stale?: boolean;
  warning?: string;
};
const positionCache = new Map<string, {
  expiresAt: number;
  staleUntil: number;
  data: PositionResponse;
}>();

export function OPTIONS() {
  return optionsResponse();
}

export async function GET(
  req: NextRequest,
  { params }: { params: { address: string } },
) {
  if (!rateLimit(req, "public:morpho-position", 120).ok) {
    return jsonResponse({ error: "Too many requests." }, { status: 429, headers: NO_STORE_HEADERS });
  }

  const userAddress = params.address;
  if (!isAddress(userAddress)) {
    return jsonResponse({ error: "Invalid wallet address." }, { status: 400, headers: NO_STORE_HEADERS });
  }
  const cacheKey = userAddress.toLowerCase();
  const cached = positionCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) {
    return jsonResponse(cached.data, { headers: NO_STORE_HEADERS });
  }

  try {
    const vaults = await getEnabledEarnVaults();
    const positions = await Promise.all(vaults.map(async (vault) => {
      const [shares, maxWithdraw, walletBalance, vaultDecimals, vaultSymbol] = await Promise.all([
        readWorldChainWithFallback((client) => client.readContract({
          address: vault.address as Address,
          abi: METAMORPHO_ABI,
          functionName: "balanceOf",
          args: [userAddress as Address],
        })),
        readWorldChainWithFallback((client) => client.readContract({
          address: vault.address as Address,
          abi: METAMORPHO_ABI,
          functionName: "maxWithdraw",
          args: [userAddress as Address],
        })),
        readWorldChainWithFallback((client) => client.readContract({
          address: vault.asset.address as Address,
          abi: ERC20_APPROVE_ABI,
          functionName: "balanceOf",
          args: [userAddress as Address],
        })),
        readWorldChainWithFallback((client) => client.readContract({
          address: vault.address as Address,
          abi: vaultMetaAbi,
          functionName: "decimals",
        })).then(Number).catch(() => 18),
        readWorldChainWithFallback((client) => client.readContract({
          address: vault.address as Address,
          abi: vaultMetaAbi,
          functionName: "symbol",
        })).then((value) => String(value).trim().slice(0, 24)).catch(() => `RE7${vault.asset.symbol}`),
      ]);
      const assets = shares > 0n
        ? await readWorldChainWithFallback((client) => client.readContract({
            address: vault.address as Address,
            abi: METAMORPHO_ABI,
            functionName: "convertToAssets",
            args: [shares],
          }))
        : 0n;
      return {
        vaultAddress: vault.address,
        displayName: vault.displayName,
        asset: vault.asset,
        shareSymbol: vaultSymbol,
        shareDecimals: vaultDecimals,
        shares: shares.toString(),
        sharesFormatted: formatUnits(shares, vaultDecimals),
        assets: assets.toString(),
        assetsFormatted: formatUnits(assets, vault.asset.decimals),
        maxWithdraw: maxWithdraw.toString(),
        maxWithdrawFormatted: formatUnits(maxWithdraw, vault.asset.decimals),
        walletBalance: walletBalance.toString(),
        walletBalanceFormatted: formatUnits(walletBalance, vault.asset.decimals),
      };
    }));

    const data: PositionResponse = { address: userAddress, positions, updatedAt: new Date().toISOString() };
    positionCache.set(cacheKey, {
      data,
      expiresAt: Date.now() + POSITION_CACHE_TTL_MS,
      staleUntil: Date.now() + POSITION_STALE_TTL_MS,
    });
    return jsonResponse(data, { headers: NO_STORE_HEADERS });
  } catch (error) {
    console.error("Failed to read Morpho positions", error);
    if (cached && cached.staleUntil > Date.now()) {
      return jsonResponse(
        {
          ...cached.data,
          stale: true,
          warning: "Using the last successful on-chain Earn position snapshot.",
        },
        { headers: NO_STORE_HEADERS },
      );
    }
    return jsonResponse({ error: "Unable to read Morpho positions." }, { status: 502, headers: NO_STORE_HEADERS });
  }
}
