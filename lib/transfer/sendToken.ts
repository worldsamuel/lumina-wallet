import { MiniKit } from "@worldcoin/minikit-js";
import { Tokens } from "@worldcoin/minikit-js/commands";
import { encodeFunctionData, isAddress, parseUnits, toHex, type Address } from "viem";
import { publicClient } from "../chain";

const WLD_ADDRESS = "0x2cFc85d8E48F8EAB294be644d9E25C3030863003" as Address;

const erc20MinABI = [
  {
    type: "function",
    name: "transfer",
    stateMutability: "nonpayable",
    inputs: [
      { name: "to", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [{ name: "", type: "bool" }],
  },
  {
    type: "function",
    name: "balanceOf",
    stateMutability: "view",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
  },
] as const;

export interface SendParams {
  tokenSymbol: "WLD" | "USDC" | "ETH" | string;
  tokenAddress: `0x${string}` | null;
  tokenDecimals: number;
  recipient: string;
  amountHuman: string;
  userAddress?: string;
}

export interface SendResult {
  status: "success" | "user_rejected" | "failed";
  txHash?: string;
  error?: string;
}

type MiniKitPayResult = {
  executedWith?: string;
  data?: {
    transactionId?: string;
    transaction_id?: string;
    reference?: string;
    from?: string;
    chain?: string;
    timestamp?: string;
    status?: string;
    error_code?: string;
    message?: string;
  };
  transactionId?: string;
  transaction_id?: string;
  status?: string;
  error_code?: string;
  message?: string;
};

type MiniKitTransactionResult = {
  commandPayload?: unknown;
  finalPayload?: {
    status?: string;
    transaction_id?: string;
    userOpHash?: string;
    error_code?: string;
    message?: string;
  };
  status?: string;
  transaction_id?: string;
  userOpHash?: string;
  error_code?: string;
  message?: string;
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

function extractPayPayload(result: MiniKitPayResult) {
  return result.data ?? result;
}

function extractPayTransactionId(payload: MiniKitPayResult) {
  return payload.transactionId ?? payload.transaction_id ?? undefined;
}

function normalizeError(error: unknown) {
  if (typeof error === "object" && error && "code" in error) {
    return String((error as { code?: unknown }).code);
  }
  if (error instanceof Error) return error.message;
  return String(error || "generic_error");
}

function extractTransactionPayload(result: MiniKitTransactionResult) {
  return result.finalPayload ?? result;
}

function safeTypeOf(getValue: () => unknown) {
  try {
    return typeof getValue();
  } catch (error) {
    const err = error as { message?: unknown };
    return `throws: ${String(err?.message ?? error)}`;
  }
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

  const tokenSymbol = params.tokenSymbol.toUpperCase();
  const payToken =
    tokenSymbol === "WLD"
      ? Tokens.WLD
      : tokenSymbol === "USDC"
        ? Tokens.USDC
        : null;

  const referenceBase = params.userAddress && isAddress(params.userAddress)
    ? params.userAddress.slice(2, 12)
    : "guest";
  const payPayload = payToken
    ? {
        reference: `lumina-${referenceBase}-${Date.now()}`.slice(0, 36),
        to: params.recipient as Address,
        tokens: [
          {
            symbol: payToken,
            token_amount: amountWei.toString(),
          },
        ],
        description: `Transfer ${params.amountHuman} ${params.tokenSymbol.toUpperCase()}`,
      }
    : null;
  const transactions =
    params.tokenAddress === null
      ? [
          {
            to: params.recipient,
            value: toHex(amountWei),
          },
        ]
      : [
          {
            to: params.tokenAddress,
            data: encodeFunctionData({
              abi: [erc20MinABI[0]],
              functionName: "transfer",
              args: [params.recipient as Address, amountWei],
            }),
            value: "0x0",
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
  console.log(payToken ? "pay payload:" : "transaction payload:");
  console.log(
    JSON.stringify(
      payToken ? payPayload : transactions,
      (_key, value) => (typeof value === "bigint" ? value.toString() : value),
      2,
    ),
  );

  if (params.userAddress && isAddress(params.userAddress)) {
    try {
      const [ethBalance, wldBalance] = await Promise.all([
        publicClient.getBalance({ address: params.userAddress as Address }),
        publicClient.readContract({
          address: WLD_ADDRESS,
          abi: erc20MinABI,
          functionName: "balanceOf",
          args: [params.userAddress as Address],
        }),
      ]);
      console.log("[C1] ETH balance (for gas):", ethBalance.toString());
      console.log("[C2] WLD balance:", wldBalance.toString());
      console.log("[C3] Sending WLD amount:", amountWei.toString());
      console.log("[C4] Is sending more than balance?", amountWei > wldBalance);
      console.log("[C5] Has ETH for gas?", ethBalance > 100000000000000n);
    } catch (error) {
      console.log("[C ERROR] balance/gas diagnostics failed:", error);
    }
  } else {
    console.log("[C SKIP] userAddress missing or invalid:", params.userAddress);
  }

  const miniKitStatus = MiniKit as unknown as { isInstalled?: () => boolean };
  console.log("[STEP 1] About to call", payToken ? "MiniKit.pay" : "MiniKit.sendTransaction");
  console.log("[STEP 1] MiniKit.isInstalled?", miniKitStatus.isInstalled?.());
  console.log(
    "[STEP 1] payload:",
    JSON.stringify(
      payToken ? payPayload : transactions,
      (_key, value) => (typeof value === "bigint" ? value.toString() : value),
      2,
    ),
  );

  const startTime = Date.now();

  console.log("[A1] Before await");
  console.log("[A2] typeof MiniKit:", typeof MiniKit);
  console.log("[A3] typeof MiniKit.pay:", safeTypeOf(() => MiniKit.pay));
  console.log("[A4] typeof MiniKit.sendTransaction:", safeTypeOf(() => MiniKit.sendTransaction));

  try {
    const txPromise = payToken
      ? MiniKit.pay(payPayload!)
      : MiniKit.sendTransaction({ transactions, chainId: 480 });
    const timeoutPromise = new Promise<never>((_resolve, reject) =>
      setTimeout(() => reject(new Error("TIMEOUT_15S")), 15000),
    );
    console.log("[A5] Promise created, racing with 15s timeout");

    const result = (await Promise.race([txPromise, timeoutPromise])) as MiniKitPayResult & {
      commandPayload?: unknown;
      finalPayload?: {
        status?: string;
        transaction_id?: string;
      };
    };
    console.log("[A6] SUCCESS, result:", JSON.stringify(result, null, 2));
    console.log("[STEP 2] returned after", Date.now() - startTime, "ms");
    console.log("[STEP 2] result:", JSON.stringify(result, null, 2));
    console.log("[STEP 2] result.commandPayload:", result?.commandPayload);
    console.log("[STEP 2] result.finalPayload:", result?.finalPayload);
    console.log("[STEP 2] result.finalPayload?.status:", result?.finalPayload?.status);
    console.log("[STEP 2] result.finalPayload?.transaction_id:", result?.finalPayload?.transaction_id);
    console.log("=== MiniKit success ===");
    console.log(JSON.stringify(result, null, 2));
    const payload = payToken
      ? extractPayPayload(result)
      : extractTransactionPayload(result as MiniKitTransactionResult);

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
      txHash: payToken
        ? extractPayTransactionId(payload)
        : ((payload as MiniKitTransactionResult).transaction_id ??
          (payload as MiniKitTransactionResult).userOpHash),
    };
  } catch (error) {
    const err = error as {
      name?: unknown;
      message?: unknown;
      code?: unknown;
    };
    console.log("[STEP 2 ERROR] threw after", Date.now() - startTime, "ms");
    console.log("[STEP 2 ERROR] name:", err?.name);
    console.log("[STEP 2 ERROR] message:", err?.message);
    console.log("[STEP 2 ERROR] code:", err?.code);
    console.log("[A6] FAIL:", err?.message);
    console.log("[A6] full error:", JSON.stringify(error, Object.getOwnPropertyNames(error || {}), 2));
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
