import { MiniKit } from "@worldcoin/minikit-js";
import { decodeFunctionData, encodeFunctionData, formatUnits, isAddress, parseUnits, type Address } from "viem";
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
  quote?: QuoteResponse;
};

type QuoteResponse = {
  source: string;
  amountIn: string;
  amountInRaw?: string;
  grossAmountIn?: string;
  amountOut: string;
  amountOutRaw: string;
  grossAmountOut?: string;
  grossAmountOutRaw?: string;
  feeTier: number;
  route?: {
    tokens: string[];
    fees: number[];
  };
  priceImpactPercent?: number;
  gasEstimateUsd?: number;
  blocked?: boolean;
  blockReason?: string;
  tokens: {
    from: ExecuteSwapToken;
    to: ExecuteSwapToken;
  };
  platformFee?: PlatformFeePayload | null;
};

type PlatformFeePayload = {
  businessType: "swap";
  token: Address;
  recipient: Address;
  percent: string;
  bps?: number;
  amountRaw: string;
  amount: string;
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
  platformFee?: PlatformFeePayload | null;
  permit2Spender?: Address;
  deadline: number;
  debug?: unknown;
};

type MiniKitTransactionResult = {
  data?: {
    status?: string;
    userOpHash?: string;
    error_code?: string;
    message?: string;
    details?: unknown;
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

  const freshQuote = params.quote?.amountOutRaw ? params.quote : await fetchFreshQuote(params);
  if (freshQuote.source !== "uniswap-v3") {
    throw new Error("Phase 2 execution currently supports Uniswap V3 routes only.");
  }
  if (freshQuote.blocked) throw new Error(freshQuote.blockReason || "Quote is blocked.");

  const skipPlatformFeeForSell = shouldSkipPlatformFeeForSell(freshQuote.tokens.from, freshQuote.tokens.to);
  const built = await buildSwapTxOnServer({
    fromToken: freshQuote.tokens.from,
    toToken: freshQuote.tokens.to,
    fromAmountHuman: params.fromAmountHuman,
    slippageBps: params.slippageBps,
    userAddress: params.userAddress,
    quote: freshQuote,
    skipPlatformFee: skipPlatformFeeForSell,
  });
  if (skipPlatformFeeForSell) {
    console.log("[SWAP DEBUG] skipping platform fee for sell direction", {
      from: freshQuote.tokens.from.symbol,
      to: freshQuote.tokens.to.symbol,
    });
  }
  try {
    return await submitBuiltSwap(built, freshQuote, params, fromAmount, "primary");
  } catch (error) {
    if (!built.platformFee || isUserCancellation(error)) throw error;
    console.warn("[SWAP] MiniKit rejected fee-enabled tx, retrying without platform fee", error);
    const fallbackQuote = {
      ...freshQuote,
      amountOut: freshQuote.grossAmountOut || freshQuote.amountOut,
      amountOutRaw: freshQuote.grossAmountOutRaw || freshQuote.amountOutRaw,
      platformFee: null,
    };
    const fallbackBuilt = await buildSwapTxOnServer({
      fromToken: fallbackQuote.tokens.from,
      toToken: fallbackQuote.tokens.to,
      fromAmountHuman: params.fromAmountHuman,
      slippageBps: params.slippageBps,
      userAddress: params.userAddress,
      quote: fallbackQuote,
      skipPlatformFee: true,
    });
    return await submitBuiltSwap(fallbackBuilt, fallbackQuote, params, fromAmount, "fee-fallback");
  }
}

const universalRouterExecuteAbi = [
  {
    type: "function",
    name: "execute",
    stateMutability: "payable",
    inputs: [
      { name: "commands", type: "bytes" },
      { name: "inputs", type: "bytes[]" },
      { name: "deadline", type: "uint256" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "execute",
    stateMutability: "payable",
    inputs: [
      { name: "commands", type: "bytes" },
      { name: "inputs", type: "bytes[]" },
    ],
    outputs: [],
  },
] as const;

async function submitBuiltSwap(
  built: BuildTxResponse,
  quote: QuoteResponse,
  params: ExecuteSwapParams,
  fromAmount: bigint,
  attempt: "primary" | "fee-fallback",
) {
  const tx = built.tx;
  const executableQuote = built.quote;
  const executableAmount = BigInt(executableQuote.amountInRaw ?? fromAmount.toString());
  const expectedOut = BigInt(executableQuote.amountOutRaw);
  const feeConfig = built.platformFee ? { bps: built.platformFee.bps, recipient: built.platformFee.recipient } : null;
  const universalRouter = decodeUniversalRouterExecute(tx.data);
  const universalRouterCommands = universalRouter?.commands ?? null;
  const permit2Spender = built.permit2Spender ?? UNIVERSAL_ROUTER_ADDRESS;
  const permit2Expiration = 0;
  const permit2Param = {
    permitted: {
      token: quote.tokens.from.address,
      amount: assertUint160(executableAmount),
    },
    spender: permit2Spender,
    nonce: null,
    deadline: permit2Expiration,
    sigDeadline: null,
  };
  console.log("[SWAP] fee config:", feeConfig);
  console.log("[SWAP DEBUG] sell direction:", quote.tokens.from.symbol !== "WLD" && quote.tokens.to.symbol === "WLD");
  console.log(
    "[SWAP DEBUG] permit2 param:",
    JSON.stringify(permit2Param, (_key, value) => (typeof value === "bigint" ? value.toString() : value)),
  );
  console.log("[SWAP DEBUG] universal router commands:", universalRouterCommands);
  console.log("[SWAP DEBUG] universal router inputs lengths:", universalRouter?.inputLengths ?? null);
  // World App rejects broad ERC20 approve flows for many tokens, so keep the
  // executable batch on the Permit2 + Universal Router path that is already
  // supported by MiniKit.
  // Official MiniKit docs require expiration=0 for Permit2 allowance transfers.
  const transactions = [
    {
      to: PERMIT2_ADDRESS,
      data: encodeFunctionData({
        abi: [permit2Abi[0]],
        functionName: "approve",
        args: [quote.tokens.from.address, permit2Spender, assertUint160(executableAmount), permit2Expiration],
      }),
      value: "0x0",
    },
    tx,
  ];
  const debug = {
    attempt,
    fromToken: quote.tokens.from,
    toToken: quote.tokens.to,
    fromAmountHuman: params.fromAmountHuman,
    executableAmountRaw: executableAmount.toString(),
    expectedOutRaw: expectedOut.toString(),
    platformFee: built.platformFee ?? null,
    serverDebug: built.debug ?? null,
    feeConfig,
    universalRouterCommands,
    permit2Spender,
    transactions: transactions.map((item, index) => ({
      index,
      to: item.to,
      value: item.value,
      dataPrefix: item.data.slice(0, 10),
      dataLength: item.data.length,
    })),
  };

  let result: MiniKitTransactionResult;
  try {
    result = (await withTimeout(
      MiniKit.sendTransaction({
        chainId: WORLD_CHAIN_ID,
        transactions,
      }),
      30_000,
      "sendTransaction timed out before returning userOpHash.",
    )) as MiniKitTransactionResult;
  } catch (error) {
    throw attachSwapDebug(error, { ...debug, stage: "minikit:throw" });
  }

  const payload = result.data;
  console.log("[SWAP] MiniKit.sendTransaction result", result);
  if (payload?.status && payload.status !== "success") {
    throw attachSwapDebug(new Error(payload.error_code || payload.message || "Swap was not submitted."), {
      ...debug,
      stage: "minikit:status",
      result,
    });
  }
  if (payload?.error_code) {
    throw attachSwapDebug(new Error(payload.error_code), { ...debug, stage: "minikit:error_code", result });
  }
  const userOpHash = payload?.userOpHash;
  if (!userOpHash) {
    throw attachSwapDebug(new Error(`No userOpHash returned: ${JSON.stringify(result)}`), {
      ...debug,
      stage: "minikit:no_user_op",
      result,
    });
  }

  return {
    userOpHash,
    expectedOut: executableQuote.amountOut,
    expectedOutRaw: expectedOut.toString(),
    minOut: formatUnits(applySlippage(expectedOut, params.slippageBps), executableQuote.tokens.to.decimals),
    quote: executableQuote,
  };
}

function decodeUniversalRouterExecute(data: `0x${string}`) {
  try {
    const decoded = decodeFunctionData({ abi: universalRouterExecuteAbi, data });
    const inputs = decoded.args[1] as readonly `0x${string}`[];
    return {
      commands: String(decoded.args[0]),
      inputLengths: inputs.map((input) => input.length),
    };
  } catch {
    return null;
  }
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

async function buildSwapTxOnServer(params: ExecuteSwapParams & { skipPlatformFee?: boolean }): Promise<BuildTxResponse> {
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
      skipPlatformFee: params.skipPlatformFee,
      quote: params.quote
        ? {
            source: params.quote.source,
            amountInRaw: params.quote.amountInRaw,
            amountOut: params.quote.amountOut,
            amountOutRaw: params.quote.amountOutRaw,
            grossAmountOut: params.quote.grossAmountOut,
            grossAmountOutRaw: params.quote.grossAmountOutRaw,
            feeTier: params.quote.feeTier,
            route: params.quote.route,
          }
        : undefined,
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
  const value = Number(process.env.NEXT_PUBLIC_SWAP_MAX_USD || "100000");
  return Number.isFinite(value) && value > 0 ? Math.min(value, 100000) : 100000;
}

function isSwapEnabled() {
  return process.env.NEXT_PUBLIC_SWAP_ENABLED === "true";
}

function shouldSkipPlatformFeeForSell(fromToken: ExecuteSwapToken, toToken: ExecuteSwapToken) {
  return fromToken.symbol !== "WLD" && toToken.symbol === "WLD";
}

function applySlippage(amount: bigint, slippageBps: number) {
  return (amount * BigInt(10_000 - slippageBps)) / 10_000n;
}

function assertUint160(amount: bigint) {
  const maxUint160 = (1n << 160n) - 1n;
  if (amount > maxUint160) throw new Error("Swap amount exceeds Permit2 allowance limit.");
  return amount;
}

function attachSwapDebug(error: unknown, debug: unknown) {
  const err = error instanceof Error ? error : new Error(String(error || "Swap failed."));
  (err as Error & { debug?: unknown }).debug = debug;
  return err;
}

function isUserCancellation(error: unknown) {
  const message = error instanceof Error ? error.message : String(error || "");
  return /user_rejected|cancelled|canceled|rejected/i.test(message);
}

export function friendlySwapError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error || "Swap failed.");
  if (/invalid_token/i.test(message)) return "Token not active in World App Permit2 list";
  if (/invalid_contract/i.test(message)) return "Token not supported";
  if (/disallowed_operation/i.test(message)) return "Blocked by World App";
  if (/permitted_amount_exceeds_slippage|permitted_amount_not_found/i.test(message)) return "Approval failed";
  if (/TRANSFER_FROM_FAILED/i.test(message)) return "Sell may be restricted";
  if (/V3TooLittleReceived|TooLittleReceived|INSUFFICIENT_OUTPUT_AMOUNT/i.test(message)) return "Refresh quote";
  if (/TransactionDeadlinePassed|DeadlineExpired|EXPIRED/i.test(message)) return "Quote expired";
  if (/user_rejected/i.test(message)) return "Transaction cancelled";
  return "Swap failed";
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string) {
  return Promise.race([
    promise,
    new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error(message)), timeoutMs);
    }),
  ]);
}
