import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import {
  createPublicClient,
  createWalletClient,
  formatEther,
  formatUnits,
  http,
  parseEther,
  parseUnits,
  publicActions,
  type Address,
  type Chain,
  type Hash,
  type Hex,
  type TransactionReceipt,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { ERC20_APPROVE_ABI, METAMORPHO_ABI } from "../lib/morpho/abi";
import { buildDepositTx, buildRedeemTx } from "../lib/morpho/transactions";
import type { MorphoVault } from "../lib/morpho/vaults";

const WORLD_CHAIN_ID = 480;
const RE7_USDC_VAULT = "0xb1E80387EbE53Ff75a89736097D34dC8D9E9045B" as const;
const WORLD_USDC = "0x79A02482A880bCE3F13e09Da970dC34db4CD24d1" as const;
const ONE_USDC = parseUnits("1", 6);
const MIN_REQUIRED_USDC = parseUnits("5", 6);
const TOP_UP_USDC = parseUnits("10", 6);
const GAS_TOP_UP = parseEther("10");
const FINAL_BALANCE_TOLERANCE = parseUnits("0.00001", 6);

type Snapshot<T> = {
  label: string;
  value: T;
  blockNumber: bigint;
  timestamp: bigint;
};

type TxResult = {
  label: string;
  hash: Hash;
  status: TransactionReceipt["status"];
  gasUsed: bigint;
  blockNumber: bigint;
  timestamp: bigint;
};

type ReportContext = {
  chainId: number;
  forkBlockNumber: bigint;
  forkTimestamp: bigint;
  wallet: Address;
  explorerBaseUrl: string | null;
  vaultTotalAssetsBefore: Snapshot<bigint>;
  nativeBalanceBefore: Snapshot<bigint>;
  usdcBalanceBeforeFunding: Snapshot<bigint>;
  usdcBalanceBeforeDeposit: Snapshot<bigint>;
  usdcBalanceAfterDeposit: Snapshot<bigint>;
  usdcBalanceAfterRedeem: Snapshot<bigint>;
  sharesAfterDeposit: Snapshot<bigint>;
  assetsAfterDeposit: Snapshot<bigint>;
  assetsAfterWait: Snapshot<bigint>;
  sharesAfterRedeem: Snapshot<bigint>;
  depositTx: TxResult;
  redeemTx: TxResult;
  fundingActions: string[];
};

const worldChainFork: Chain = {
  id: WORLD_CHAIN_ID,
  name: "Tenderly Virtual TestNet fork of World Chain",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: {
    default: { http: [requiredEnv("TENDERLY_RPC_URL")] },
  },
};

const vault: MorphoVault = {
  address: RE7_USDC_VAULT,
  displayName: "Re7 USDC",
  asset: {
    address: WORLD_USDC,
    symbol: "USDC",
    decimals: 6,
  },
  riskLevel: "low",
  enabled: true,
  description: {
    "zh-CN": "稳定币 USDC 借贷理财,由 Re7 Labs 策展,Morpho 协议底层",
    en: "USDC stablecoin lending vault, curated by Re7 Labs on Morpho",
  },
};

const rpcUrl = requiredEnv("TENDERLY_RPC_URL");
const account = privateKeyToAccount(normalizePrivateKey(requiredEnv("TEST_PRIVATE_KEY")));
const publicClient = createPublicClient({
  chain: worldChainFork,
  transport: http(rpcUrl),
});
const walletClient = createWalletClient({
  account,
  chain: worldChainFork,
  transport: http(rpcUrl),
}).extend(publicActions);

async function main() {
  console.log("Starting Morpho Re7 USDC mainnet-fork verification");
  console.log(`Wallet: ${account.address}`);
  console.log(`Vault: ${RE7_USDC_VAULT}`);
  console.log(`USDC: ${WORLD_USDC}`);

  const chainId = await publicClient.getChainId();
  assert(chainId === WORLD_CHAIN_ID, `Expected chain id ${WORLD_CHAIN_ID}, got ${chainId}`);
  const forkBlock = await publicClient.getBlock({ blockTag: "latest" });

  const fundingActions: string[] = [];
  const nativeBalanceBefore = await snapshot("native balance before funding", () =>
    publicClient.getBalance({ address: account.address }),
  );
  if (nativeBalanceBefore.value < parseEther("0.05")) {
    await tenderlySetBalance(account.address, GAS_TOP_UP);
    fundingActions.push(`Native gas balance topped up to ${formatEther(GAS_TOP_UP)} ETH via tenderly_setBalance`);
  }

  const usdcBalanceBeforeFunding = await snapshot("USDC balance before funding", () => readUsdcBalance());
  if (usdcBalanceBeforeFunding.value < MIN_REQUIRED_USDC) {
    await tenderlySetErc20Balance(WORLD_USDC, account.address, TOP_UP_USDC);
    fundingActions.push(`USDC balance topped up to ${formatUnits(TOP_UP_USDC, 6)} USDC via tenderly_setErc20Balance`);
  }

  const usdcBalanceBeforeDeposit = await snapshot("USDC balance before deposit", () => readUsdcBalance());
  assert(
    usdcBalanceBeforeDeposit.value >= MIN_REQUIRED_USDC,
    `USDC balance must be >= 5 USDC, got ${formatUsdc(usdcBalanceBeforeDeposit.value)}`,
  );

  const vaultTotalAssetsBefore = await snapshot("vault totalAssets before deposit", () =>
    publicClient.readContract({
      address: RE7_USDC_VAULT,
      abi: METAMORPHO_ABI,
      functionName: "totalAssets",
    }),
  );

  const depositBundle = buildDepositTx(vault, ONE_USDC, account.address);
  const approveTxRequest = depositBundle.transactions[0];
  const depositTxRequest = depositBundle.transactions[1];
  await sendAndRecord(
    "approve 1 USDC for Re7 USDC vault",
    approveTxRequest.to,
    approveTxRequest.data,
  );
  const depositTx = await sendAndRecord(
    "deposit 1 USDC into Re7 USDC vault",
    depositTxRequest.to,
    depositTxRequest.data,
  );

  const usdcBalanceAfterDeposit = await snapshot("USDC balance after deposit", () => readUsdcBalance());
  const sharesAfterDeposit = await snapshot("vault shares after deposit", () => readVaultShares());
  assert(sharesAfterDeposit.value > 0n, "Expected shares after deposit to be greater than zero");
  const assetsAfterDeposit = await snapshot("assets represented by shares after deposit", () =>
    convertToAssets(sharesAfterDeposit.value),
  );
  assertClose(assetsAfterDeposit.value, ONE_USDC, parseUnits("0.0001", 6), "deposit assets should be approximately 1 USDC");

  console.log("Waiting 60 seconds before re-reading shares -> assets");
  await sleep(60_000);
  const assetsAfterWait = await snapshot("assets represented by shares after 60s", () =>
    convertToAssets(sharesAfterDeposit.value),
  );

  const redeemTxRequest = buildRedeemTx(vault, sharesAfterDeposit.value, account.address);
  const redeemTx = await sendAndRecord(
    "redeem all Re7 USDC vault shares",
    redeemTxRequest.to,
    redeemTxRequest.data,
  );

  const usdcBalanceAfterRedeem = await snapshot("USDC balance after redeem", () => readUsdcBalance());
  const sharesAfterRedeem = await snapshot("vault shares after redeem", () => readVaultShares());
  assert(sharesAfterRedeem.value === 0n, `Expected final vault shares to be 0, got ${sharesAfterRedeem.value}`);
  assertClose(
    usdcBalanceAfterRedeem.value,
    usdcBalanceBeforeDeposit.value,
    FINAL_BALANCE_TOLERANCE,
    "final USDC balance should return close to pre-deposit balance",
  );

  const report: ReportContext = {
    chainId,
    forkBlockNumber: forkBlock.number,
    forkTimestamp: forkBlock.timestamp,
    wallet: account.address,
    explorerBaseUrl: explorerBaseUrl(),
    vaultTotalAssetsBefore,
    nativeBalanceBefore,
    usdcBalanceBeforeFunding,
    usdcBalanceBeforeDeposit,
    usdcBalanceAfterDeposit,
    usdcBalanceAfterRedeem,
    sharesAfterDeposit,
    assetsAfterDeposit,
    assetsAfterWait,
    sharesAfterRedeem,
    depositTx,
    redeemTx,
    fundingActions,
  };
  const reportPath = await writeReport(report);
  console.log(`Verification report written: ${reportPath}`);
  console.log("Morpho Re7 USDC mainnet-fork verification completed successfully");
}

async function readUsdcBalance() {
  return publicClient.readContract({
    address: WORLD_USDC,
    abi: ERC20_APPROVE_ABI,
    functionName: "balanceOf",
    args: [account.address],
  });
}

async function readVaultShares() {
  return publicClient.readContract({
    address: RE7_USDC_VAULT,
    abi: METAMORPHO_ABI,
    functionName: "balanceOf",
    args: [account.address],
  });
}

async function convertToAssets(shares: bigint) {
  return publicClient.readContract({
    address: RE7_USDC_VAULT,
    abi: METAMORPHO_ABI,
    functionName: "convertToAssets",
    args: [shares],
  });
}

async function snapshot<T>(label: string, read: () => Promise<T>): Promise<Snapshot<T>> {
  const value = await read();
  const block = await publicClient.getBlock({ blockTag: "latest" });
  console.log(`${label}: ${String(value)} at block ${block.number}, timestamp ${block.timestamp}`);
  return {
    label,
    value,
    blockNumber: block.number,
    timestamp: block.timestamp,
  };
}

async function sendAndRecord(label: string, to: Address, data: Hex): Promise<TxResult> {
  console.log(`Sending ${label}`);
  const hash = await walletClient.sendTransaction({
    account,
    chain: worldChainFork,
    to,
    data,
    value: 0n,
  });
  console.log(`${label} tx hash: ${hash}`);
  const receipt = await publicClient.waitForTransactionReceipt({ hash, confirmations: 1 });
  assert(receipt.status === "success", `${label} failed with status ${receipt.status}`);
  const block = await publicClient.getBlock({ blockNumber: receipt.blockNumber });
  console.log(`${label} status=${receipt.status}, gasUsed=${receipt.gasUsed}, block=${receipt.blockNumber}`);
  return {
    label,
    hash,
    status: receipt.status,
    gasUsed: receipt.gasUsed,
    blockNumber: receipt.blockNumber,
    timestamp: block.timestamp,
  };
}

async function tenderlySetBalance(address: Address, amount: bigint) {
  await rpc("tenderly_setBalance", [[address], toQuantityHex(amount)]);
}

async function tenderlySetErc20Balance(token: Address, wallet: Address, amount: bigint) {
  await rpc("tenderly_setErc20Balance", [token, wallet, toQuantityHex(amount)]);
}

async function rpc(method: string, params: unknown[]) {
  const response = await fetch(rpcUrl, {
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
  if (!response.ok || body.error) {
    throw new Error(`${method} failed: ${body.error?.message ?? response.statusText}`);
  }
  return body.result;
}

async function writeReport(context: ReportContext) {
  const date = new Date().toISOString().slice(0, 10);
  const reportPath = join(process.cwd(), "scripts", `verification-report-${date}.md`);
  await mkdir(dirname(reportPath), { recursive: true });
  await writeFile(reportPath, renderReport(context));
  return reportPath;
}

function renderReport(context: ReportContext) {
  return `# Morpho Re7 USDC Mainnet-Fork Verification

## Environment

- Chain ID: ${context.chainId}
- Fork block number: ${context.forkBlockNumber}
- Fork block timestamp: ${context.forkTimestamp} (${formatUnix(context.forkTimestamp)})
- Test wallet: \`${context.wallet}\`
- Vault: \`${RE7_USDC_VAULT}\`
- USDC: \`${WORLD_USDC}\`

## Funding Checks

- ${formatSnapshot(context.nativeBalanceBefore, formatEth)}
- ${formatSnapshot(context.usdcBalanceBeforeFunding, formatUsdc)}
- ${formatSnapshot(context.usdcBalanceBeforeDeposit, formatUsdc)}
- Funding actions: ${context.fundingActions.length ? context.fundingActions.join("; ") : "none"}

## Vault Snapshot Before Deposit

- ${formatSnapshot(context.vaultTotalAssetsBefore, formatUsdc)}

## Transactions

| Step | Tx hash | Status | Gas used | On-chain timestamp | Tenderly link |
| --- | --- | --- | ---: | --- | --- |
| Deposit | \`${context.depositTx.hash}\` | ${context.depositTx.status} | ${context.depositTx.gasUsed} | ${context.depositTx.timestamp} (${formatUnix(context.depositTx.timestamp)}) | ${txLink(context.depositTx.hash, context.explorerBaseUrl)} |
| Redeem | \`${context.redeemTx.hash}\` | ${context.redeemTx.status} | ${context.redeemTx.gasUsed} | ${context.redeemTx.timestamp} (${formatUnix(context.redeemTx.timestamp)}) | ${txLink(context.redeemTx.hash, context.explorerBaseUrl)} |

## Position Snapshots

- ${formatSnapshot(context.usdcBalanceAfterDeposit, formatUsdc)}
- ${formatSnapshot(context.sharesAfterDeposit, (value) => value.toString())}
- ${formatSnapshot(context.assetsAfterDeposit, formatUsdc)}
- ${formatSnapshot(context.assetsAfterWait, formatUsdc)}${context.assetsAfterWait.value > context.assetsAfterDeposit.value ? "" : " (no growth observed on fork after 60 seconds; allowed)"}

## Final Balance Reconciliation

- ${formatSnapshot(context.usdcBalanceAfterRedeem, formatUsdc)}
- ${formatSnapshot(context.sharesAfterRedeem, (value) => value.toString())}
- Expected final vault shares: 0
- Expected final USDC balance: close to ${formatUsdc(context.usdcBalanceBeforeDeposit.value)} with tolerance ${formatUsdc(FINAL_BALANCE_TOLERANCE)}

Verified on: Tenderly Virtual TestNet (fork from World Chain mainnet block ${context.forkBlockNumber}).
`;
}

function txLink(hash: Hash, explorerBase: string | null) {
  if (!explorerBase) return "Set TENDERLY_EXPLORER_BASE_URL to include a clickable dashboard link";
  return `[Open](${explorerBase.replace(/\/$/, "")}/tx/${hash})`;
}

function formatSnapshot<T>(snapshotValue: Snapshot<T>, formatter: (value: T) => string) {
  return `${snapshotValue.label}: ${formatter(snapshotValue.value)} (read at block ${snapshotValue.blockNumber}, timestamp ${snapshotValue.timestamp} / ${formatUnix(snapshotValue.timestamp)})`;
}

function explorerBaseUrl() {
  return process.env.TENDERLY_EXPLORER_BASE_URL?.trim() || null;
}

function formatUsdc(value: bigint) {
  return `${formatUnits(value, 6)} USDC`;
}

function formatEth(value: bigint) {
  return `${formatEther(value)} ETH`;
}

function formatUnix(timestamp: bigint) {
  return new Date(Number(timestamp) * 1000).toISOString();
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

function assertClose(actual: bigint, expected: bigint, tolerance: bigint, message: string) {
  const diff = actual > expected ? actual - expected : expected - actual;
  if (diff > tolerance) {
    throw new Error(`${message}. actual=${actual}, expected=${expected}, tolerance=${tolerance}, diff=${diff}`);
  }
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

main();
