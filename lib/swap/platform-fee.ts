import { formatUnits, isAddress, type Address } from "viem";
import { ensureDefaultFees } from "@/lib/admin/ensure-fee-schema";
import { db } from "@/lib/db";
import type { SwapToken } from "./tokens";

export type SwapPlatformFeeConfig = {
  recipient: Address;
  percent: string;
  bps: number;
};

export type SwapPlatformFeePayload = {
  businessType: "swap";
  token: Address;
  recipient: Address;
  percent: string;
  bps: number;
  amountRaw: string;
  amount: string;
};

export async function getSwapPlatformFeeConfig(): Promise<SwapPlatformFeeConfig | null> {
  await ensureDefaultFees();
  const config = await db.feeConfig.findUnique({ where: { businessType: "swap" } });
  const recipient = String(config?.recipient ?? "").trim();
  if (!isAddress(recipient)) return null;

  const percent = String(config?.percent ?? "0");
  const bps = Math.round(Number(percent) * 10_000);
  if (!Number.isFinite(bps) || bps <= 0) return null;
  if (bps >= 10_000) throw new Error("Configured swap fee is too high.");

  return {
    recipient,
    percent,
    bps,
  };
}

export function applySwapOutputFee(
  to: SwapToken,
  grossAmountOut: bigint,
  config: SwapPlatformFeeConfig | null,
): { netAmountOut: bigint; payload: SwapPlatformFeePayload | null } {
  if (!config || grossAmountOut <= 0n) return { netAmountOut: grossAmountOut, payload: null };

  const feeAmount = (grossAmountOut * BigInt(config.bps)) / 10_000n;
  const netAmountOut = grossAmountOut - feeAmount;
  if (netAmountOut <= 0n) throw new Error("Configured swap fee is too high for this output amount.");

  return {
    netAmountOut,
    payload: {
      businessType: "swap",
      token: to.address,
      recipient: config.recipient,
      percent: config.percent,
      bps: config.bps,
      amountRaw: feeAmount.toString(),
      amount: formatUnits(feeAmount, to.decimals),
    },
  };
}
