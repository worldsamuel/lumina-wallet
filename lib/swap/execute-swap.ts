import { MiniKit } from "@worldcoin/minikit-js";
import { encodeFunctionData, formatUnits, isAddress, parseUnits, type Address } from "viem";
import { PERMIT2_ADDRESS, UNIVERSAL_ROUTER_ADDRESS, WORLD_CHAIN_ID, permit2Abi } from "./contracts";

type ExecuteSwapToken = {
  address: Address;
  symbol: string;
  decimals: number;
  name?: string;
  priceUsd?: number;
};

export type ExecuteSwapParams = {
  fromToken: ExecuteSwapToken;
  toToken: ExecuteSwapToken;
  fromAmountHuman: string;
  slippageBps: number;
  userAddress: Address;
  forceHighImpact?: boolean;
};

type QuoteResponse = {
  source: string;
  amountIn: string;
  amountOut: string;
  amountOutRaw: string;
  feeTier: number;
  priceImpactPercent?: number;
  gasEstimateUsd?: number;
  blocked?: boolean;
  blockReason?: string;
  tokens: {
    from: ExecuteSwapToken;
    to: ExecuteSwapToken;
  };
};

type BuildTxResponse = {
  tx: {
    to: Address;
    data: `0x${string}`;
    value: `0x${string}`;
  };
  quote: QuoteResponse & {
    gasEstimate?: string;
  };
  deadline: number;
};

type MiniKitTransactionResult = {
  data?: {
    status?: string;
    userOpHash?: string;
    error_code?: string;
    message?: string;
  };
};

export async function executeSwap(params: ExecuteSwapParams) {
  if (!isSwapEnabled()) throw new Error("Swap mainnet execution is disabled.");
  if (!isAddress(params.userAddress)) throw new Error("Connect wallet before swapping.");
  if (params.slippageBps <= 0) throw new Error("Slippage cannot be 0. Please choose at least 0.1%.");

  const fromAmount = parseUnits(params.fromAmountHuman.replace(/,/g, "").trim(), params.fromToken.decimals);
  if (fromAmount <= 0n) throw new Error("Enter an amount greater than 0.");

  const amountUsd = estimateAmountUsd(params.fromAmountHuman, params.fromToken.priceUsd);
  const maxUsd = getSwapMaxUsd();
  if (amountUsd !== null && amountUsd > maxUsd) {
    throw new Error(`Single swap limit is $${maxUsd}. Please reduce the amount.`);
  }

  const freshQuote = await fetchFreshQuote(params);
  if (freshQuote.source !== "uniswap-v3") {
    throw new Error("Phase 2 execution currently supports Uniswap V3 routes only.");
  }
  if (freshQuote.blocked) throw new Error(freshQuote.blockReason || "Quote is blocked.");
  const impact = Number(freshQuote.priceImpactPercent || 0);
  if (impact > 15) throw new Error("Price impact is above 15%. Swap blocked to protect funds.");
  if (impact > 5 && !params.forceHighImpact) {
    throw new Error("Price impact is above 5%. Please confirm the high-impact warning.");
  }

  const built = await buildSwapTxOnServer({
    fromToken: freshQuote.tokens.from,
    toToken: freshQuote.tokens.to,
    fromAmountHuman: params.fromAmountHuman,
    slippageBps: params.slippageBps,
    userAddress: params.userAddress,
  });
  const tx = built.tx;
  const executableQuote = built.quote;
  const expectedOut = BigInt(executableQuote.amountOutRaw);
  // World App consumes this Permit2 allowance in the same sendTransaction batch.
  // Official MiniKit docs require expiration=0 for Permit2 allowance transfers.
  const permit2Expiration = 0;

  const transactions = [
    {
      to: PERMIT2_ADDRESS,
      data: encodeFunctionData({
        abi: [permit2Abi[0]],
        functionName: "approve",
        args: [freshQuote.tokens.from.address, UNIVERSAL_ROUTER_ADDRESS, assertUint160(fromAmount), permit2Expiration],
      }),
      value: "0x0",
    },
    tx,
  ];

  const result = (await withTimeout(
    MiniKit.sendTransaction({
      chainId: WORLD_CHAIN_ID,
      transactions,
    }),
    30_000,
    "sendTransaction timed out before returning userOpHash.",
  )) as MiniKitTransactionResult;

  const payload = result.data;
  console.log("[SWAP] MiniKit.sendTransaction result", result);
  if (payload?.status && payload.status !== "success") {
    throw new Error(payload.error_code || payload.message || "Swap was not submitted.");
  }
  if (payload?.error_code) throw new Error(payload.error_code);
  const userOpHash = payload?.userOpHash;
  if (!userOpHash) throw new Error(`No userOpHash returned: ${JSON.stringify(result)}`);

  return {
    userOpHash,
    expectedOut: executableQuote.amountOut,
    expectedOutRaw: expectedOut.toString(),
    minOut: formatUnits(applySlippage(expectedOut, params.slippageBps), executableQuote.tokens.to.decimals),
    quote: executableQuote,
  };
}

async function fetchFreshQuote(params: ExecuteSwapParams): Promise<QuoteResponse> {
  const response = await fetch("/api/swap/quote", {
    method: "POST",
    headers: { "content-type": "application/json" },
    cache: "no-store",
    body: JSON.stringify({
      fromToken: params.fromToken.address,
      toToken: params.toToken.address,
      fromSymbol: params.fromToken.symbol,
      toSymbol: params.toToken.symbol,
      fromAmount: params.fromAmountHuman,
      slippageBps: params.slippageBps,
    }),
  });
  const data = await response.json().catch(() => null);
  if (!response.ok) throw new Error(data?.error || "Fresh quote failed.");
  if (!data?.amountOutRaw) throw new Error("Fresh quote did not include raw amount out.");
  return data as QuoteResponse;
}

async function buildSwapTxOnServer(params: ExecuteSwapParams): Promise<BuildTxResponse> {
  const response = await fetch("/api/swap/build-tx", {
    method: "POST",
    headers: { "content-type": "application/json" },
    cache: "no-store",
    body: JSON.stringify({
      fromToken: params.fromToken.address,
      toToken: params.toToken.address,
      fromSymbol: params.fromToken.symbol,
      toSymbol: params.toToken.symbol,
      fromAmount: params.fromAmountHuman,
      slippageBps: params.slippageBps,
      userAddress: params.userAddress,
    }),
  });
  const data = await response.json().catch(() => null);
  if (!response.ok) throw new Error(data?.error || "Swap transaction build failed.");
  if (!data?.tx?.to || !data?.tx?.data || !data?.quote?.amountOutRaw) {
    throw new Error("Swap transaction build returned an invalid payload.");
  }
  return data as BuildTxResponse;
}

function estimateAmountUsd(amountHuman: string, priceUsd?: number) {
  const amount = Number(amountHuman.replace(/,/g, "").trim());
  if (!Number.isFinite(amount) || amount <= 0 || !priceUsd || priceUsd <= 0) return null;
  return amount * priceUsd;
}

function getSwapMaxUsd() {
  const value = Number(process.env.NEXT_PUBLIC_SWAP_MAX_USD || "5");
  return Number.isFinite(value) && value > 0 ? Math.min(value, 5) : 5;
}

function isSwapEnabled() {
  return process.env.NEXT_PUBLIC_SWAP_ENABLED === "true";
}

function applySlippage(amount: bigint, slippageBps: number) {
  return (amount * BigInt(10_000 - slippageBps)) / 10_000n;
}

function assertUint160(amount: bigint) {
  const maxUint160 = (1n << 160n) - 1n;
  if (amount > maxUint160) throw new Error("Swap amount exceeds Permit2 allowance limit.");
  return amount;
}

export function friendlySwapError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error || "Swap failed.");
  if (/invalid_contract/i.test(message)) return "暂时不支持此代币,请联系客服";
  if (/disallowed_operation/i.test(message)) return "World App 暂时拦截了此交易,请确认 Permit2/Universal Router 已在开发者后台加入白名单";
  if (/permitted_amount_exceeds_slippage|permitted_amount_not_found/i.test(message)) return "授权金额校验失败,请刷新报价后重试";
  if (/TRANSFER_FROM_FAILED/i.test(message)) return "Permit2 签名或授权失败,请重新签名后再试。";
  if (/V3TooLittleReceived|TooLittleReceived|INSUFFICIENT_OUTPUT_AMOUNT/i.test(message)) return "价格变化过大,请重新报价";
  if (/TransactionDeadlinePassed|DeadlineExpired|EXPIRED/i.test(message)) return "交易过期,请重新提交";
  if (/user_rejected/i.test(message)) return "您取消了交易。";
  return "交易失败,请查看 Activity 页详情";
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string) {
  return Promise.race([
    promise,
    new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error(message)), timeoutMs);
    }),
  ]);
}
