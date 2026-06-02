import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { AllowanceTransfer, type PermitSingle } from "@uniswap/permit2-sdk";
import {
  createPublicClient,
  createWalletClient,
  encodeFunctionData,
  formatEther,
  formatUnits,
  http,
  parseEther,
  parseUnits,
  publicActions,
  type Address,
  type Chain,
  type Hex,
  type TransactionReceipt,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { buildSwapTransaction } from "../lib/swap/build-swap-tx";
import { PERMIT2_ADDRESS, UNIVERSAL_ROUTER_ADDRESS, WORLD_CHAIN_ID, permit2Abi, swapErc20Abi } from "../lib/swap/contracts";
import { SWAP_TOKENS } from "../lib/swap/tokens";

type TokenKey = "WLD" | "USDC" | "WETH";

type TestCase = {
  name: string;
  from: TokenKey;
  to: TokenKey;
  amount: string;
  slippageBps: number;
  deadlineOffset: number;
  expect: "success" | "revert";
  expectedRevertReason?: string;
  description: string;
};

type QuoteResponse = {
  source: string;
  amountOut: string;
  amountOutRaw: string;
  feeTier: number;
  blocked?: boolean;
  blockReason?: string;
  priceImpactPercent?: number;
  gasEstimateUsd?: number;
};

type TestResult = TestCase & {
  result: "PASS" | "FAIL" | "WARN" | "ERROR";
  quote?: QuoteResponse;
  approveHash?: Hex;
  txHash?: Hex;
  txUrl?: string;
  gasUsed?: bigint;
  error?: string;
  actualError?: string;
  revertReason?: string;
};

const TENDERLY_RPC = requiredEnv("TENDERLY_RPC_URL");
const account = privateKeyToAccount(normalizePrivateKey(requiredEnv("TEST_PRIVATE_KEY")));
const TEST_USER = account.address;
const QUOTE_BASE_URL = process.env.SWAP_QUOTE_BASE_URL?.trim() || "http://localhost:3000";
const EXPLORER_BASE_URL = process.env.TENDERLY_EXPLORER_BASE_URL?.trim() || "";
const SKIP_TENDERLY_FUNDING = process.env.SKIP_TENDERLY_FUNDING === "true";

const TOKENS = {
  WLD: SWAP_TOKENS.WLD,
  USDC: SWAP_TOKENS.USDC,
  WETH: SWAP_TOKENS.WETH,
} satisfies Record<TokenKey, (typeof SWAP_TOKENS)[keyof typeof SWAP_TOKENS]>;

const TESTS: TestCase[] = [
  {
    name: "1_WLD_to_USDC_small",
    from: "WLD",
    to: "USDC",
    amount: "1",
    slippageBps: 50,
    deadlineOffset: 1800,
    expect: "success",
    description: "正常 1 WLD -> USDC 应该成功",
  },
  {
    name: "2_USDC_to_WLD_small",
    from: "USDC",
    to: "WLD",
    amount: "1",
    slippageBps: 50,
    deadlineOffset: 1800,
    expect: "success",
    description: "反向 1 USDC -> WLD 应该成功",
  },
  {
    name: "3_WETH_to_USDC",
    from: "WETH",
    to: "USDC",
    amount: "0.01",
    slippageBps: 50,
    deadlineOffset: 1800,
    expect: "success",
    description: "0.01 WETH -> USDC, 测试 3 个 token 之间路径",
  },
  {
    name: "4_dust_amount",
    from: "USDC",
    to: "WLD",
    amount: "0.01",
    slippageBps: 50,
    deadlineOffset: 1800,
    expect: "success",
    description: "极小额测试, 验证不会有 rounding 问题",
  },
  {
    name: "5_slippage_protection",
    from: "USDC",
    to: "WLD",
    amount: "1",
    slippageBps: 10,
    deadlineOffset: 1800,
    expect: "revert",
    expectedRevertReason: "V3TooLittleReceived | TooLittleReceived",
    description: "1 USDC -> WLD 正常报价后人为抬高 minOut 10%, 必须触发滑点保护",
  },
  {
    name: "6_deadline_expired",
    from: "USDC",
    to: "WLD",
    amount: "1",
    slippageBps: 50,
    deadlineOffset: -300,
    expect: "revert",
    expectedRevertReason: "TransactionDeadlinePassed | DeadlineExpired",
    description: "deadline 已过期, Universal Router 必须 revert",
  },
];

const worldChainFork: Chain = {
  id: WORLD_CHAIN_ID,
  name: "World Chain Virtual TestNet",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: {
    default: { http: [TENDERLY_RPC] },
  },
};

const publicClient = createPublicClient({
  chain: worldChainFork,
  transport: http(TENDERLY_RPC),
});

const walletClient = createWalletClient({
  account,
  chain: worldChainFork,
  transport: http(TENDERLY_RPC),
}).extend(publicActions);

async function main() {
  console.log("Starting Tenderly verification suite for Lumina Swap Phase 2");
  console.log(`Wallet: ${TEST_USER}`);
  console.log(`Total cases: ${TESTS.length}`);

  const chainId = await publicClient.getChainId();
  assert(chainId === WORLD_CHAIN_ID, `Expected chain id ${WORLD_CHAIN_ID}, got ${chainId}`);
  await fundTestWallet();

  const results: TestResult[] = [];
  for (const test of TESTS) {
    results.push(await runTest(test));
  }

  const report = renderReport(results);
  const reportPath = join(process.cwd(), "verification-report-tenderly.md");
  await writeFile(reportPath, report);
  console.log(`\nReport saved to ${reportPath}`);

  const failed = results.filter((result) => result.result === "FAIL" || result.result === "ERROR").length;
  process.exit(failed > 0 ? 1 : 0);
}

async function runTest(test: TestCase): Promise<TestResult> {
  console.log(`\n========== ${test.name} ==========`);
  console.log(test.description);

  try {
    await resetCaseBalances(test);
    const fromToken = TOKENS[test.from];
    const toToken = TOKENS[test.to];
    const fromAmount = parseUnits(test.amount, fromToken.decimals);
    const quote = await fetchQuote(test);
    if (quote.source !== "uniswap-v3") {
      throw new Error(`Phase 2 execution supports uniswap-v3 only, got ${quote.source}`);
    }
    if (!quote.amountOutRaw || BigInt(quote.amountOutRaw) <= 0n) {
      throw new Error(`Quote failed: ${JSON.stringify(quote)}`);
    }

    const approveHash = await approvePermit2(fromToken.address, fromAmount);
    const deadline = Math.floor(Date.now() / 1000) + test.deadlineOffset;
    const permitDeadline = test.name === "6_deadline_expired" ? Math.floor(Date.now() / 1000) + 1800 : deadline;
    const { permit, signature } = await signPermit2(fromToken.address, fromAmount, permitDeadline);
    const expectedAmountOut =
      test.name === "5_slippage_protection" ? (BigInt(quote.amountOutRaw) * 11_000n) / 10_000n : BigInt(quote.amountOutRaw);
    const tx = await buildSwapTransaction({
      fromToken,
      toToken,
      fromAmount,
      expectedAmountOut,
      feeTier: quote.feeTier,
      slippageBps: test.slippageBps,
      userAddress: TEST_USER,
      deadline,
      permit,
      signature,
    });

    const receipt = await sendSwap(tx.to, tx.data, BigInt(tx.value));
    const txUrl = tenderlyTxUrl(receipt.transactionHash);
    const succeeded = receipt.status === "success";

    if (test.expect === "success") {
      if (!succeeded) {
        const error = await getTenderlyError(receipt.transactionHash);
        console.log(`FAIL: expected success but reverted: ${error}`);
        return { ...test, quote, approveHash, txHash: receipt.transactionHash, txUrl, gasUsed: receipt.gasUsed, result: "FAIL", error };
      }
      console.log(`PASS: swap succeeded, gas=${receipt.gasUsed}`);
      return { ...test, quote, approveHash, txHash: receipt.transactionHash, txUrl, gasUsed: receipt.gasUsed, result: "PASS" };
    }

    if (succeeded) {
      console.log("FAIL: expected revert but transaction succeeded");
      return {
        ...test,
        quote,
        approveHash,
        txHash: receipt.transactionHash,
        txUrl,
        gasUsed: receipt.gasUsed,
        result: "FAIL",
        error: "Expected revert but transaction succeeded.",
      };
    }

    const errorMsg = await getTenderlyError(receipt.transactionHash);
    const matched = matchesExpectedRevert(errorMsg, test.expectedRevertReason);
    console.log(`${matched ? "PASS" : "WARN"}: reverted with ${errorMsg}`);
    return {
      ...test,
      quote,
      approveHash,
      txHash: receipt.transactionHash,
      txUrl,
      gasUsed: receipt.gasUsed,
      result: matched ? "PASS" : "WARN",
      revertReason: matched ? errorMsg : undefined,
      actualError: matched ? undefined : errorMsg,
    };
  } catch (error) {
    const message = normalizeErrorMessage(error);
    console.log(`ERROR: ${message}`);
    return { ...test, result: "ERROR", error: message };
  }
}

async function fundTestWallet() {
  if (SKIP_TENDERLY_FUNDING) {
    console.log("Skipping Tenderly funding because SKIP_TENDERLY_FUNDING=true");
    return;
  }
  await tenderlySetBalance(TEST_USER, parseEther("10"));
  await tenderlySetErc20Balance(TOKENS.USDC.address, TEST_USER, parseUnits("110000", TOKENS.USDC.decimals));
  await tenderlySetErc20Balance(TOKENS.WLD.address, TEST_USER, parseUnits("500", TOKENS.WLD.decimals));
  await tenderlySetErc20Balance(TOKENS.WETH.address, TEST_USER, parseUnits("1", TOKENS.WETH.decimals));
  console.log("Funded test wallet on Tenderly Virtual TestNet");
}

async function resetCaseBalances(test: TestCase) {
  if (SKIP_TENDERLY_FUNDING) return;
  await tenderlySetBalance(TEST_USER, parseEther("10"));
  const required = parseUnits(test.amount, TOKENS[test.from].decimals);
  const amount = required > parseUnits("1000", TOKENS[test.from].decimals) ? required * 2n : parseUnits(baseFunding(test.from), TOKENS[test.from].decimals);
  await tenderlySetErc20Balance(TOKENS[test.from].address, TEST_USER, amount);
}

function baseFunding(token: TokenKey) {
  if (token === "WETH") return "1";
  if (token === "WLD") return "500";
  return "1000";
}

async function fetchQuote(test: TestCase): Promise<QuoteResponse> {
  let lastError = "";
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    const response = await fetch(`${QUOTE_BASE_URL.replace(/\/$/, "")}/api/swap/quote`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        fromSymbol: test.from,
        toSymbol: test.to,
        fromAmount: test.amount,
      }),
    });
    const data = (await response.json().catch(() => null)) as QuoteResponse | { error?: string } | null;
    if (response.ok && data && "amountOutRaw" in data) {
      console.log(`Quote: ${test.amount} ${test.from} -> ${data.amountOut} ${test.to}, fee=${data.feeTier}`);
      return data;
    }
    lastError = `Quote failed (${response.status}): ${JSON.stringify(data)}`;
    if (attempt < 3) await sleep(1_500);
  }
  throw new Error(lastError);
}

async function approvePermit2(token: Address, amount: bigint) {
  const hash = await walletClient.sendTransaction({
    account,
    chain: worldChainFork,
    to: token,
    data: encodeFunctionData({
      abi: [swapErc20Abi[2]],
      functionName: "approve",
      args: [PERMIT2_ADDRESS, amount],
    }),
    value: 0n,
    gas: 100_000n,
  });
  const receipt = await publicClient.waitForTransactionReceipt({ hash, confirmations: 1 });
  assert(receipt.status === "success", `Permit2 approve failed for ${token}`);
  return hash;
}

async function signPermit2(token: Address, amount: bigint, deadline: number) {
  const [, , nonce] = await publicClient.readContract({
    address: PERMIT2_ADDRESS,
    abi: permit2Abi,
    functionName: "allowance",
    args: [TEST_USER, token, UNIVERSAL_ROUTER_ADDRESS],
  });
  const permit: PermitSingle = {
    details: {
      token,
      amount: amount.toString(),
      expiration: deadline,
      nonce: nonce.toString(),
    },
    spender: UNIVERSAL_ROUTER_ADDRESS,
    sigDeadline: deadline,
  };
  const { domain, types, values } = AllowanceTransfer.getPermitData(permit, PERMIT2_ADDRESS, WORLD_CHAIN_ID);
  const signature = await account.signTypedData({
    domain: domain as never,
    types: types as never,
    primaryType: "PermitSingle",
    message: values as never,
  } as never);
  return { permit, signature };
}

async function sendSwap(to: Address, data: Hex, value: bigint): Promise<TransactionReceipt> {
  const hash = await walletClient.sendTransaction({
    account,
    chain: worldChainFork,
    to,
    data,
    value,
    gas: 1_000_000n,
  });
  return publicClient.waitForTransactionReceipt({ hash, confirmations: 1 });
}

async function tenderlySetBalance(address: Address, amount: bigint) {
  await rpc("tenderly_setBalance", [[address], toQuantityHex(amount)]);
}

async function tenderlySetErc20Balance(token: Address, wallet: Address, amount: bigint) {
  await rpc("tenderly_setErc20Balance", [token, wallet, toQuantityHex(amount)]);
}

async function getTenderlyError(hash: Hex) {
  const tx = (await rpc("tenderly_getTransaction", [hash]).catch(() => null)) as { error_message?: string; decoded_error?: string } | null;
  const tenderlyMessage = tx?.error_message || tx?.decoded_error;
  if (tenderlyMessage) return tenderlyMessage;
  const traces = (await rpc("trace_transaction", [hash]).catch(() => null)) as Array<{ traceAddress: unknown[]; error?: string; result?: { output?: string } }> | null;
  const root = traces?.find((trace) => Array.isArray(trace.traceAddress) && trace.traceAddress.length === 0);
  const selector = root?.result?.output?.slice(0, 10);
  if (selector) return decodeRevertSelector(selector);
  return "Reverted; Tenderly RPC did not return a decoded reason.";
}

async function rpc(method: string, params: unknown[]) {
  const response = await fetch(TENDERLY_RPC, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: Date.now(),
      method,
      params,
    }),
  });
  const body = (await response.json()) as { result?: unknown; error?: { message?: string } };
  if (!response.ok || body.error) throw new Error(`${method} failed: ${body.error?.message ?? response.statusText}`);
  return body.result;
}

function renderReport(results: TestResult[]) {
  const passed = results.filter((result) => result.result === "PASS").length;
  const warn = results.filter((result) => result.result === "WARN").length;
  const failed = results.filter((result) => result.result === "FAIL" || result.result === "ERROR").length;
  const gasValues = results.filter((result) => result.gasUsed !== undefined).map((result) => result.gasUsed!);
  const totalGas = gasValues.reduce((sum, value) => sum + value, 0n);

  return `# Lumina Swap Phase 2 - Tenderly Verification Report

**Date**: ${new Date().toISOString()}
**Network**: World Chain Virtual TestNet (chainId ${WORLD_CHAIN_ID})
**RPC**: ${redactRpc(TENDERLY_RPC)}
**Test wallet**: \`${TEST_USER}\`
**Total cases**: ${TESTS.length}
**Passed**: ${passed}
**Warn**: ${warn}
**Failed**: ${failed}

## Summary

${results.map((result) => `- ${statusIcon(result.result)} **${result.name}**: ${result.result}${result.txUrl ? ` - [Tenderly trace](${result.txUrl})` : ""}`).join("\n")}

## Gas Statistics

- Successful/reverted swap transactions measured: ${gasValues.length}
- Total gas used: ${totalGas}
- Average gas used: ${gasValues.length ? totalGas / BigInt(gasValues.length) : 0n}
- Max gas used: ${gasValues.length ? gasValues.reduce((max, value) => (value > max ? value : max), 0n) : 0n}
- Min gas used: ${gasValues.length ? gasValues.reduce((min, value) => (value < min ? value : min), gasValues[0]) : 0n}

## Detailed Results

${results.map(renderResult).join("\n")}

## Verdict

${failed === 0 && warn === 0 ? "✅ **ALL TESTS PASSED** - Safe to proceed to mainnet small-amount testing." : `❌ **${failed} FAIL/ERROR, ${warn} WARN** - DO NOT enable mainnet. Fix or review issues first.`}

## Notes

- The configured \`TEST_PRIVATE_KEY\` derives to \`${TEST_USER}\`; tests used that address so Permit2 signatures are valid.
- The prompt-listed fixed wallet \`0x0f3b31df2fa6781de2103588da675f02599b2b26\` was not used because the local test private key does not control it.
- Case 5 intentionally raised \`expectedAmountOut\` by 10% before building calldata, creating a deterministic stale/over-optimistic minOut condition that validates the Universal Router slippage guard.
- \`NEXT_PUBLIC_SWAP_ENABLED\` remains false in the example/test environment.
`;
}

function renderResult(result: TestResult) {
  return `### ${result.name}

- **Description**: ${result.description}
- **From**: ${result.amount} ${result.from} -> ${result.to}
- **Expected**: ${result.expect}${result.expectedRevertReason ? ` (${result.expectedRevertReason})` : ""}
- **Slippage**: ${result.slippageBps / 100}%
- **Result**: **${result.result}**
${result.quote ? `- **Quote**: ${result.quote.amountOut} ${result.to} (raw ${result.quote.amountOutRaw}, fee ${result.quote.feeTier}, source ${result.quote.source})` : ""}
${result.quote?.blocked ? `- **Quote blocked**: ${result.quote.blockReason || "true"}` : ""}
${result.approveHash ? `- **Permit2 approve tx**: \`${result.approveHash}\`` : ""}
${result.txHash ? `- **Swap tx**: \`${result.txHash}\`` : ""}
${result.txUrl ? `- **Tenderly**: [View trace](${result.txUrl})` : ""}
${result.gasUsed ? `- **Gas used**: ${result.gasUsed}` : ""}
${result.error ? `- **Error**: \`${escapeBackticks(result.error)}\`` : ""}
${result.actualError ? `- **Actual revert**: \`${escapeBackticks(result.actualError)}\`` : ""}
${result.revertReason ? `- **Revert reason**: \`${escapeBackticks(result.revertReason)}\`` : ""}
`;
}

function matchesExpectedRevert(actual: string, expected?: string) {
  if (!expected) return true;
  const normalizedActual = actual.toLowerCase();
  return expected
    .split("|")
    .map((part) => part.trim().toLowerCase())
    .some((part) => part.length > 0 && normalizedActual.includes(part));
}

function decodeRevertSelector(selector: string) {
  const errors: Record<string, string> = {
    "0x39d35496": "V3TooLittleReceived()",
    "0x5bf6f916": "TransactionDeadlinePassed()",
    "0xc9f52c71": "TooLittleReceived()",
    "0x2c4029e9": "ExecutionFailed(uint256,bytes)",
    "0xd81b2f2e": "AllowanceExpired(uint256)",
    "0xf96fb071": "InsufficientAllowance(uint256)",
    "0x815e1d64": "InvalidSigner()",
    "0x8baa579f": "InvalidSignature()",
  };
  return errors[selector] || `Unknown custom error selector ${selector}`;
}

function tenderlyTxUrl(hash: Hex) {
  if (!EXPLORER_BASE_URL) return "";
  return `${EXPLORER_BASE_URL.replace(/\/$/, "")}/tx/${hash}`;
}

function statusIcon(status: TestResult["result"]) {
  if (status === "PASS") return "✅";
  if (status === "WARN") return "⚠️";
  return "❌";
}

function redactRpc(value: string) {
  return value.replace(/([0-9a-f]{8})-[0-9a-f-]+/i, "$1-...");
}

function escapeBackticks(value: string) {
  return value.replace(/`/g, "\\`");
}

function normalizeErrorMessage(error: unknown) {
  const raw = error instanceof Error ? error.message : String(error);
  if (raw.includes("You've reached the quota limit")) {
    return "Tenderly quota reached: You've reached the quota limit for your current plan. Upgrade your plan in the dashboard or contact support to continue.";
  }
  if (raw.includes("Method \"eth_sendRawTransaction\" is not supported")) {
    return raw.split("\n").find((line) => line.includes("Method \"eth_sendRawTransaction\" is not supported")) || raw;
  }
  return raw.length > 1200 ? `${raw.slice(0, 1200)}...` : raw;
}

function normalizePrivateKey(value: string): Hex {
  const privateKey = value.trim();
  return (privateKey.startsWith("0x") ? privateKey : `0x${privateKey}`) as Hex;
}

function requiredEnv(name: string) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing required env var ${name}`);
  return value;
}

function toQuantityHex(value: bigint) {
  return `0x${value.toString(16)}`;
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

main();
