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
const POSITION_CACHE_TTL_MS = 30_000;
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
const pendingPositionReads = new Map<string, Promise<PositionResponse>>();
const vaultMetaCache = new Map<string, { decimals: number; symbol: string }>();

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
  const refresh = req.nextUrl.searchParams.get("refresh") === "1";
  const cached = positionCache.get(cacheKey);
  if (!refresh && cached && cached.expiresAt > Date.now()) {
    return jsonResponse(cached.data, { headers: NO_STORE_HEADERS });
  }

  try {
    const existing = pendingPositionReads.get(cacheKey);
    const data = existing ?? readPositions(userAddress as Address)
      .finally(() => pendingPositionReads.delete(cacheKey));
    if (!existing) pendingPositionReads.set(cacheKey, data);
    const resolved = await data;
    positionCache.set(cacheKey, {
      data: resolved,
      expiresAt: Date.now() + POSITION_CACHE_TTL_MS,
      staleUntil: Date.now() + POSITION_STALE_TTL_MS,
    });
    return jsonResponse(resolved, { headers: NO_STORE_HEADERS });
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

async function readPositions(userAddress: Address): Promise<PositionResponse> {
  const vaults = await getEnabledEarnVaults();
  const positionContracts = vaults.flatMap((vault) => [
    {
      address: vault.address as Address,
      abi: METAMORPHO_ABI,
      functionName: "balanceOf" as const,
      args: [userAddress],
    },
    {
      address: vault.address as Address,
      abi: METAMORPHO_ABI,
      functionName: "maxWithdraw" as const,
      args: [userAddress],
    },
    {
      address: vault.asset.address as Address,
      abi: ERC20_APPROVE_ABI,
      functionName: "balanceOf" as const,
      args: [userAddress],
    },
  ]);
  const reads = await readWorldChainWithFallback((client) =>
    client.multicall({ allowFailure: true, contracts: positionContracts }),
  );
  const metadata = await getVaultMetadata(vaults);
  const base = vaults.map((vault, index) => ({
    vault,
    shares: readMulticallResult<bigint>(reads, index * 3, 0n),
    maxWithdraw: readMulticallResult<bigint>(reads, index * 3 + 1, 0n),
    walletBalance: readMulticallResult<bigint>(reads, index * 3 + 2, 0n),
  }));
  const active = base.filter((entry) => entry.shares > 0n);
  const assetReads = active.length
    ? await readWorldChainWithFallback((client) =>
        client.multicall({
          allowFailure: true,
          contracts: active.map((entry) => ({
            address: entry.vault.address as Address,
            abi: METAMORPHO_ABI,
            functionName: "convertToAssets" as const,
            args: [entry.shares],
          })),
        }),
      )
    : [];
  const assetsByVault = new Map(
    active.map((entry, index) => [
      entry.vault.address.toLowerCase(),
      readMulticallResult<bigint>(assetReads, index, entry.maxWithdraw),
    ]),
  );
  const positions = base.map(({ vault, shares, maxWithdraw, walletBalance }) => {
    const meta = metadata.get(vault.address.toLowerCase()) ?? {
      decimals: 18,
      symbol: `RE7${vault.asset.symbol}`,
    };
    const assets = assetsByVault.get(vault.address.toLowerCase()) ?? 0n;
    return {
      vaultAddress: vault.address,
      displayName: vault.displayName,
      asset: vault.asset,
      shareSymbol: meta.symbol,
      shareDecimals: meta.decimals,
      shares: shares.toString(),
      sharesFormatted: formatUnits(shares, meta.decimals),
      assets: assets.toString(),
      assetsFormatted: formatUnits(assets, vault.asset.decimals),
      maxWithdraw: maxWithdraw.toString(),
      maxWithdrawFormatted: formatUnits(maxWithdraw, vault.asset.decimals),
      walletBalance: walletBalance.toString(),
      walletBalanceFormatted: formatUnits(walletBalance, vault.asset.decimals),
    };
  });
  return { address: userAddress, positions, updatedAt: new Date().toISOString() };
}

async function getVaultMetadata(vaults: Awaited<ReturnType<typeof getEnabledEarnVaults>>) {
  const missing = vaults.filter((vault) => !vaultMetaCache.has(vault.address.toLowerCase()));
  if (missing.length) {
    const contracts = missing.flatMap((vault) => [
      {
        address: vault.address as Address,
        abi: vaultMetaAbi,
        functionName: "decimals" as const,
      },
      {
        address: vault.address as Address,
        abi: vaultMetaAbi,
        functionName: "symbol" as const,
      },
    ]);
    const reads = await readWorldChainWithFallback((client) =>
      client.multicall({ allowFailure: true, contracts }),
    );
    missing.forEach((vault, index) => {
      vaultMetaCache.set(vault.address.toLowerCase(), {
        decimals: Number(readMulticallResult<bigint | number>(reads, index * 2, 18)),
        symbol: String(readMulticallResult<string>(reads, index * 2 + 1, `RE7${vault.asset.symbol}`)).trim().slice(0, 24),
      });
    });
  }
  return vaultMetaCache;
}

function readMulticallResult<T>(results: readonly unknown[], index: number, fallback: T): T {
  const item = results[index] as { status?: string; result?: unknown } | undefined;
  return item?.status === "success" ? item.result as T : fallback;
}
