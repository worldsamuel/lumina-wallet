import { formatUnits, isAddress, type Address } from "viem";
import type { SwapToken } from "./tokens";

const DEFAULT_SWAP_FEE_BPS = 40;
const DEFAULT_SWAP_FEE_RECIPIENT = "0x600a84949f0f0023adf6ed89cccd2b2ceccf1077";

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

export function getSwapPlatformFeeConfig(): SwapPlatformFeeConfig | null {
  const bps = Number(process.env.NEXT_PUBLIC_SWAP_FEE_BPS || DEFAULT_SWAP_FEE_BPS);
  if (!Number.isInteger(bps) || bps <= 0) return null;
  if (bps >= 10_000) throw new Error("Configured swap fee is too high.");

  const recipient = String(process.env.NEXT_PUBLIC_SWAP_FEE_RECIPIENT ?? DEFAULT_SWAP_FEE_RECIPIENT).trim();
  if (!isAddress(recipient)) return null;

  return {
    recipient: recipient as Address,
    percent: String(bps / 10_000),
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
