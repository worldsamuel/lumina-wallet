import { formatUnits, isAddress, type Address } from "viem";
import { ensureDefaultFees } from "@/lib/admin/ensure-fee-schema";
import { db } from "@/lib/db";
import type { SwapToken } from "./tokens";

export type SwapPlatformFee = {
  feeAmount: bigint;
  swapAmount: bigint;
  payload: {
    businessType: "swap";
    token: Address;
    recipient: Address;
    percent: string;
    amountRaw: string;
    amount: string;
  };
};

export async function getSwapPlatformFee(from: SwapToken, grossAmount: bigint): Promise<SwapPlatformFee | null> {
  if (grossAmount <= 0n) return null;

  await ensureDefaultFees();
  const config = await db.feeConfig.findUnique({ where: { businessType: "swap" } });
  const recipient = String(config?.recipient ?? "").trim();
  if (!isAddress(recipient)) return null;

  const percent = String(config?.percent ?? "0");
  const bps = Math.round(Number(percent) * 10_000);
  if (!Number.isFinite(bps) || bps <= 0) return null;

  const feeAmount = (grossAmount * BigInt(bps)) / 10_000n;
  if (feeAmount <= 0n) return null;
  const swapAmount = grossAmount - feeAmount;
  if (swapAmount <= 0n) throw new Error("Configured swap fee is too high for this amount.");

  return {
    feeAmount,
    swapAmount,
    payload: {
      businessType: "swap",
      token: from.address,
      recipient,
      percent,
      amountRaw: feeAmount.toString(),
      amount: formatUnits(feeAmount, from.decimals),
    },
  };
}
