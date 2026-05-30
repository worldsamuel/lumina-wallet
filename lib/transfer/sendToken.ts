import { MiniKit } from "@worldcoin/minikit-js";
import { isAddress, parseUnits, type Address } from "viem";

const transferAbi = [
  {
    name: "transfer",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "to", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [{ type: "bool" }],
  },
] as const;

export interface SendParams {
  tokenSymbol: "WLD" | "USDC" | "ETH" | string;
  tokenAddress: `0x${string}` | null;
  tokenDecimals: number;
  recipient: string;
  amountHuman: string;
}

export interface SendResult {
  status: "success" | "user_rejected" | "failed";
  txHash?: string;
  error?: string;
}

type MiniKitSendResult = {
  status?: string;
  userOpHash?: string;
  transactionHash?: string | null;
  transaction_id?: string | null;
  transactionId?: string | null;
  error_code?: string;
  message?: string;
  data?: {
    status?: string;
    userOpHash?: string;
    transactionHash?: string | null;
    transaction_id?: string | null;
    transactionId?: string | null;
    error_code?: string;
    message?: string;
  };
};

export const ERROR_MESSAGES: Record<string, string> = {
  user_rejected: "您取消了交易",
  insufficient_balance: "余额不足",
  insufficient_funds_for_gas: "ETH 不够付 gas 费",
  invalid_address: "收款地址格式不对",
  network_error: "网络错误,请重试",
  payment_rejected: "交易被拒绝,请检查收款地址和金额",
  invalid_receiver: "收款地址无效",
  user_blocked: "当前账号暂时无法发起付款",
  input_error: "交易参数有误,请检查金额和地址",
  invalid_operation: "交易暂时无法执行",
  simulation_failed: "链上模拟失败,请检查余额或稍后重试",
  transaction_failed: "交易失败,请稍后重试",
  disallowed_operation: "World App 拒绝了这笔交易",
  validation_error: "交易校验失败",
  invalid_contract: "代币合约地址无效",
  malicious_operation: "World App 检测到高风险交易",
  daily_tx_limit_reached: "今日交易次数已达上限",
  generic_error: "交易失败,请稍后重试",
};

export function friendlySendError(error?: string) {
  if (!error) return "交易失败,请稍后重试";
  return ERROR_MESSAGES[error] ?? error;
}

function extractPayload(result: MiniKitSendResult) {
  return result.data ?? result;
}

function extractTxHash(payload: MiniKitSendResult) {
  return (
    payload.transactionHash ??
    payload.transaction_id ??
    payload.transactionId ??
    undefined
  );
}

function normalizeError(error: unknown) {
  if (typeof error === "object" && error && "code" in error) {
    return String((error as { code?: unknown }).code);
  }
  if (error instanceof Error) return error.message;
  return String(error || "generic_error");
}

export async function sendToken(params: SendParams): Promise<SendResult> {
  if (!isAddress(params.recipient)) {
    return { status: "failed", error: "invalid_address" };
  }

  let amountWei: bigint;
  try {
    amountWei = parseUnits(params.amountHuman.replace(/,/g, "").trim(), params.tokenDecimals);
  } catch {
    return { status: "failed", error: "Invalid amount" };
  }

  if (amountWei <= 0n) {
    return { status: "failed", error: "Amount must be > 0" };
  }

  const transaction =
    params.tokenAddress === null
      ? [
          {
            address: params.recipient as Address,
            abi: [],
            functionName: "",
            args: [],
            value: amountWei.toString(),
          },
        ]
      : [
          {
            address: params.tokenAddress,
            abi: transferAbi,
            functionName: "transfer",
            args: [params.recipient as Address, amountWei.toString()],
          },
        ];

  console.log("=== SEND TX DEBUG ===");
  console.log("token:", {
    symbol: params.tokenSymbol,
    address: params.tokenAddress,
    decimals: params.tokenDecimals,
    isNative: params.tokenAddress === null,
  });
  console.log("recipient:", params.recipient);
  console.log("amountHuman:", params.amountHuman);
  console.log("amountWei:", amountWei.toString());
  console.log("transaction payload:");
  console.log(
    JSON.stringify(
      transaction,
      (_key, value) => (typeof value === "bigint" ? value.toString() : value),
      2,
    ),
  );

  try {
    const result = (await MiniKit.sendTransaction({
      chainId: 480,
      transactions: transaction as never,
    })) as MiniKitSendResult;
    console.log("=== MiniKit success ===");
    console.log(JSON.stringify(result, null, 2));
    const payload = extractPayload(result);

    if (payload.status && payload.status !== "success") {
      const errCode = payload.error_code ?? payload.message ?? "generic_error";
      if (errCode === "user_rejected") return { status: "user_rejected" };
      return { status: "failed", error: errCode };
    }

    if (payload.error_code) {
      if (payload.error_code === "user_rejected") return { status: "user_rejected" };
      return { status: "failed", error: payload.error_code };
    }

    return {
      status: "success",
      txHash: extractTxHash(payload),
    };
  } catch (error) {
    const err = error as {
      name?: unknown;
      message?: unknown;
      code?: unknown;
    };
    console.log("=== MiniKit error ===");
    console.log("name:", err?.name);
    console.log("message:", err?.message);
    console.log("code:", err?.code);
    console.log("full:", JSON.stringify(error, Object.getOwnPropertyNames(error || {}), 2));
    const code = normalizeError(error);
    if (code === "user_rejected") return { status: "user_rejected" };
    return { status: "failed", error: code };
  }
}
