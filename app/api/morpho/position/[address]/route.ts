import { NextRequest } from "next/server";
import { formatUnits, isAddress, type Address } from "viem";
import { jsonResponse, optionsResponse } from "@/lib/api/cors";
import { rateLimit } from "@/lib/api/rate-limit";
import { readWorldChainWithFallback } from "@/lib/chain";
import { getEnabledEarnVaults } from "@/lib/admin/earn-products";
import { ERC20_APPROVE_ABI, METAMORPHO_ABI } from "@/lib/morpho/abi";

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
    const assetContracts = vaults.map((vault, index) => {
      const shares = resultBigInt(baseResults[index * 3], "vault shares");
      return {
        address: vault.address as Address,
        abi: METAMORPHO_ABI,
        functionName: "convertToAssets",
        args: [shares],
      };
    });
    const assetResults = await readWorldChainWithFallback((client) =>
      client.multicall({ allowFailure: true, contracts: assetContracts }),
    );

    const positions = vaults.map((vault, index) => {
      const shares = resultBigInt(baseResults[index * 3], "vault shares");
      const maxWithdraw = resultBigInt(baseResults[index * 3 + 1], "max withdraw");
      const walletBalance = resultBigInt(baseResults[index * 3 + 2], "wallet balance");
      const assets = resultBigInt(assetResults[index], "vault assets");
      return {
        vaultAddress: vault.address,
        displayName: vault.displayName,
        asset: vault.asset,
        shares: shares.toString(),
        sharesFormatted: formatUnits(shares, vault.asset.decimals),
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
