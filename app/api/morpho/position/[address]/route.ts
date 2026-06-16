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

export function OPTIONS() {
  return optionsResponse();
}

export async function GET(
  req: NextRequest,
  { params }: { params: { address: string } },
) {
  if (!rateLimit(req, "public:morpho-position", 120).ok) {
    return jsonResponse({ error: "Too many requests." }, { status: 429 });
  }

  const userAddress = params.address;
  if (!isAddress(userAddress)) {
    return jsonResponse({ error: "Invalid wallet address." }, { status: 400 });
  }

  try {
    const vaults = await getEnabledEarnVaults();
    const contracts = vaults.flatMap((vault) => [
      {
        address: vault.address as Address,
        abi: METAMORPHO_ABI,
        functionName: "balanceOf",
        args: [userAddress as Address],
      },
      {
        address: vault.address as Address,
        abi: METAMORPHO_ABI,
        functionName: "maxWithdraw",
        args: [userAddress as Address],
      },
      {
        address: vault.asset.address as Address,
        abi: ERC20_APPROVE_ABI,
        functionName: "balanceOf",
        args: [userAddress as Address],
      },
    ]);

    const baseResults = await readWorldChainWithFallback((client) =>
      client.multicall({ allowFailure: true, contracts }),
    );
    const vaultMetaContracts = vaults.flatMap((vault) => [
      {
        address: vault.address as Address,
        abi: vaultMetaAbi,
        functionName: "decimals",
      },
      {
        address: vault.address as Address,
        abi: vaultMetaAbi,
        functionName: "symbol",
      },
    ]);
    const assetContracts = vaults.map((vault, index) => {
      const shares = resultBigInt(baseResults[index * 3], "vault shares");
      return {
        address: vault.address as Address,
        abi: METAMORPHO_ABI,
        functionName: "convertToAssets",
        args: [shares],
      };
    });
    const [assetResults, vaultMetaResults] = await Promise.all([
      readWorldChainWithFallback((client) =>
        client.multicall({ allowFailure: true, contracts: assetContracts }),
      ),
      readWorldChainWithFallback((client) =>
        client.multicall({ allowFailure: true, contracts: vaultMetaContracts }),
      ),
    ]);

    const positions = vaults.map((vault, index) => {
      const shares = resultBigInt(baseResults[index * 3], "vault shares");
      const maxWithdraw = resultBigInt(baseResults[index * 3 + 1], "max withdraw");
      const walletBalance = resultBigInt(baseResults[index * 3 + 2], "wallet balance");
      const assets = resultBigInt(assetResults[index], "vault assets");
      const vaultDecimals = resultNumber(vaultMetaResults[index * 2], "vault decimals", 18);
      const vaultSymbol = resultString(vaultMetaResults[index * 2 + 1], "vault symbol", `RE7${vault.asset.symbol}`);
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
    });

    return jsonResponse({ address: userAddress, positions });
  } catch (error) {
    console.error("Failed to read Morpho positions", error);
    return jsonResponse({ error: "Unable to read Morpho positions." }, { status: 502 });
  }
}

function resultBigInt(
  result: { status: "success"; result: unknown } | { status: "failure"; error: Error } | undefined,
  label: string,
) {
  if (result?.status === "success" && typeof result.result === "bigint") return result.result;
  console.warn(`[morpho] Unable to read ${label}; using 0`);
  return 0n;
}

function resultNumber(
  result: { status: "success"; result: unknown } | { status: "failure"; error: Error } | undefined,
  label: string,
  fallback: number,
) {
  if (result?.status === "success") {
    const value = Number(result.result);
    if (Number.isFinite(value)) return value;
  }
  console.warn(`[morpho] Unable to read ${label}; using ${fallback}`);
  return fallback;
}

function resultString(
  result: { status: "success"; result: unknown } | { status: "failure"; error: Error } | undefined,
  label: string,
  fallback: string,
) {
  if (result?.status === "success" && typeof result.result === "string" && result.result.trim()) {
    return result.result.trim().slice(0, 24);
  }
  console.warn(`[morpho] Unable to read ${label}; using ${fallback}`);
  return fallback;
}
