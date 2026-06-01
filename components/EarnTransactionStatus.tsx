"use client";

import { useEffect } from "react";
import { useWaitForUserOperationReceipt } from "@worldcoin/minikit-react";
import { createPublicClient, http } from "viem";
import { worldchain } from "viem/chains";

const client = createPublicClient({
  chain: worldchain,
  transport: http("https://worldchain-mainnet.g.alchemy.com/public"),
});

type EarnTransactionStatusProps = {
  userOpHash: string;
  onSuccess?: () => void;
  onError?: (error?: Error) => void;
};

export function EarnTransactionStatus({ userOpHash, onSuccess, onError }: EarnTransactionStatusProps) {
  const { isLoading, isSuccess, isError, error } = useWaitForUserOperationReceipt({
    client,
    userOpHash,
  });

  useEffect(() => {
    if (isSuccess) onSuccess?.();
    if (isError) onError?.(error);
  }, [error, isError, isSuccess, onError, onSuccess]);

  if (!userOpHash) return null;

  const label = isSuccess
    ? "存款成功"
    : isError
      ? `失败: ${error?.message ?? "Transaction failed"}`
      : isLoading
        ? "等待区块链确认..."
        : "交易已提交";

  return (
    <div
      style={{
        position: "fixed",
        left: "50%",
        bottom: 24,
        zIndex: 9999,
        transform: "translateX(-50%)",
        maxWidth: "calc(100vw - 32px)",
        border: "1px solid rgba(74, 222, 128, 0.35)",
        borderRadius: 16,
        background: "rgba(8, 14, 12, 0.94)",
        color: "#f6fff8",
        boxShadow: "0 18px 48px rgba(0, 0, 0, 0.32)",
        padding: "12px 16px",
        fontSize: 13,
        fontWeight: 700,
        textAlign: "center",
      }}
    >
      {label}
    </div>
  );
}
