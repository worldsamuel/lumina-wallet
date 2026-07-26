import { NextRequest } from "next/server";
import { isAddress, parseUnits, type Address } from "viem";
import { jsonResponse, optionsResponse } from "@/lib/api/cors";
import { rateLimit } from "@/lib/api/rate-limit";
import { readWorldChainWithFallback } from "@/lib/chain";
import {
  EARN_WITHDRAW_FEE_BPS,
  EARN_WITHDRAW_FEE_RECIPIENT,
  buildDepositTx,
  buildRedeemWithFeeTxs,
} from "@/lib/morpho/transactions";
import { METAMORPHO_ABI } from "@/lib/morpho/abi";
import { getVaultByAddress } from "@/lib/morpho/vaults";

export const dynamic = "force-dynamic";

type Body = {
  type?: "deposit" | "withdraw" | "redeem";
  vaultAddress?: string;
  amount?: string;
  shares?: string;
  userAddress?: string;
};

function depositsPaused() {
  return process.env.MORPHO_DEPOSITS_PAUSED === "true";
}

export function OPTIONS() {
  return optionsResponse();
}

export async function POST(req: NextRequest) {
  if (!rateLimit(req, "public:morpho-tx", 120).ok) {
    return jsonResponse({ error: "Too many requests." }, { status: 429 });
  }

  const body = (await req.json().catch(() => null)) as Body | null;
  const vault = body?.vaultAddress ? getVaultByAddress(body.vaultAddress) : null;
  if (!vault || !vault.enabled) return jsonResponse({ error: "Unsupported vault." }, { status: 400 });
  if (!body?.userAddress || !isAddress(body.userAddress)) {
    return jsonResponse({ error: "Invalid user address." }, { status: 400 });
  }

  try {
    if (body.type === "deposit") {
      if (depositsPaused()) {
        return jsonResponse({ error: "Deposits are temporarily paused. Withdrawals remain available." }, { status: 423 });
      }
      const amount = parseTokenAmount(body.amount, vault.asset.decimals);
      return jsonResponse({
        ...buildDepositTx(vault, amount, body.userAddress as Address),
        depositsPaused: false,
        debug: {
          selectedVault: vault,
          assetAddress: vault.asset.address,
          assetDecimals: vault.asset.decimals,
          vaultAddress: vault.address,
          amountHuman: String(body.amount ?? ""),
          amountWei: amount.toString(),
        },
      });
    }

    if (body.type === "withdraw") {
      const amount = parseTokenAmount(body.amount, vault.asset.decimals);
      const [shares, ownedShares, maxWithdraw] = await Promise.all([
        readWorldChainWithFallback((client) => client.readContract({
          address: vault.address,
          abi: METAMORPHO_ABI,
          functionName: "previewWithdraw",
          args: [amount],
        })),
        readWorldChainWithFallback((client) => client.readContract({
          address: vault.address,
          abi: METAMORPHO_ABI,
          functionName: "balanceOf",
          args: [body.userAddress as Address],
        })),
        readWorldChainWithFallback((client) => client.readContract({
          address: vault.address,
          abi: METAMORPHO_ABI,
          functionName: "maxWithdraw",
          args: [body.userAddress as Address],
        })),
      ]);
      if (amount > maxWithdraw || shares > ownedShares) {
        return jsonResponse({ error: "Requested amount exceeds the withdrawable position." }, { status: 400 });
      }
      const grossAssets = await previewRedeem(vault.address, shares);
      return jsonResponse({
        transactions: buildRedeemWithFeeTxs(vault, shares, grossAssets, body.userAddress as Address),
        fee: {
          businessType: "earn",
          bps: EARN_WITHDRAW_FEE_BPS,
          recipient: EARN_WITHDRAW_FEE_RECIPIENT,
        },
        debug: {
          requestedAssets: amount.toString(),
          redeemShares: shares.toString(),
          grossAssets: grossAssets.toString(),
        },
      });
    }

    if (body.type === "redeem") {
      const shares = BigInt(String(body.shares ?? "0"));
      if (shares <= 0n) return jsonResponse({ error: "Invalid share amount." }, { status: 400 });
      const ownedShares = await readWorldChainWithFallback((client) => client.readContract({
        address: vault.address,
        abi: METAMORPHO_ABI,
        functionName: "balanceOf",
        args: [body.userAddress as Address],
      }));
      if (shares > ownedShares) {
        return jsonResponse({ error: "Requested shares exceed the withdrawable position." }, { status: 400 });
      }
      const grossAssets = await previewRedeem(vault.address, shares);
      return jsonResponse({
        transactions: buildRedeemWithFeeTxs(vault, shares, grossAssets, body.userAddress as Address),
        fee: {
          businessType: "earn",
          bps: EARN_WITHDRAW_FEE_BPS,
          recipient: EARN_WITHDRAW_FEE_RECIPIENT,
        },
        debug: {
          redeemShares: shares.toString(),
          grossAssets: grossAssets.toString(),
        },
      });
    }

    return jsonResponse({ error: "Unsupported transaction type." }, { status: 400 });
  } catch (error) {
    console.error("Failed to build Morpho tx", error);
    return jsonResponse({ error: "Unable to build Morpho transaction." }, { status: 400 });
  }
}

function previewRedeem(vaultAddress: Address, shares: bigint) {
  return readWorldChainWithFallback((client) => client.readContract({
    address: vaultAddress,
    abi: METAMORPHO_ABI,
    functionName: "previewRedeem",
    args: [shares],
  }));
}

function parseTokenAmount(amount: unknown, decimals: number) {
  const value = String(amount ?? "").replace(/,/g, "").trim();
  if (!value || Number(value) <= 0) throw new Error("Invalid amount");
  return parseUnits(value, decimals);
}
