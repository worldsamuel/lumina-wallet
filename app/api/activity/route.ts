import { NextRequest } from "next/server";
import { formatUnits, isAddress, parseAbi, parseAbiItem, type Address } from "viem";
import { jsonResponse, optionsResponse } from "@/lib/api/cors";
import { rateLimit } from "@/lib/api/rate-limit";
import { getStoredActivities, recordActivity } from "@/lib/admin/activity-store";
import { publicClient } from "@/lib/chain";
import { ERC20_TOKENS } from "@/lib/tokens";
import { VERIFIED_SWAP_TOKENS } from "@/lib/swap/tokens";

const transferEvent = parseAbiItem("event Transfer(address indexed from, address indexed to, uint256 value)");
const erc20MetaAbi = parseAbi(["function symbol() view returns (string)", "function decimals() view returns (uint8)"]);
const tokenMetaCache = new Map<string, { symbol: string; decimals: number }>();
const blockTimeCache = new Map<string, string>();
const activityCache = new Map<string, { expiresAt: number; data: unknown }>();
const ACTIVITY_CACHE_TTL_MS = 5_000;
const activityLookbackBlocks = 1_000_000n;
const activityLogChunkBlocks = 200_000n;
const priorityActivityLookbackBlocks = 150_000n;
const universalActivityLookbackBlocks = 80_000n;
const universalActivityLogChunkBlocks = 10_000n;
const worldChainAlchemyRpc = process.env.WORLD_CHAIN_ALCHEMY_RPC_URL || "https://worldchain-mainnet.g.alchemy.com/public";
const ACTIVITY_CHAIN_TIMEOUT_MS = 2_200;
const ACTIVITY_INDEXER_TIMEOUT_MS = 1_800;
const activityTokenAddresses = Array.from(
  new Set(
    [
      ...ERC20_TOKENS.map((token) => token.contractAddress),
      ...Object.values(VERIFIED_SWAP_TOKENS).map((token) => token.address),
    ].map((address) => address.toLowerCase()),
  ),
) as Address[];
const priorityActivityTokenAddresses = activityTokenAddresses.filter((address) =>
  [
    "0x2cfc85d8e48f8eab294be644d9e25c3030863003",
    "0x79a02482a880bce3f13e09da970dc34db4cd24d1",
  ].includes(address.toLowerCase()),
);

type ActivityTransferRow = {
  hash: `0x${string}`;
  type: "in" | "out";
  title: string;
  subtitle: string;
  amount: string;
  tokenText: string;
  tokenAmount: number;
  direction: "in" | "out";
  status: string;
  createdAt: string;
  blockNumber: number;
  logIndex: number;
};

type AlchemyAssetTransfer = {
  blockNum?: string;
  uniqueId?: string;
  hash?: string;
  from?: string;
  to?: string;
  value?: number | string | null;
  asset?: string | null;
  category?: string;
  rawContract?: {
    value?: string | null;
    address?: string | null;
    decimal?: string | number | null;
  };
  metadata?: {
    blockTimestamp?: string;
  };
};

export function OPTIONS() {
  return optionsResponse();
}

function activityResponse(data: unknown, init?: ResponseInit) {
  return jsonResponse(data, {
    ...init,
    headers: {
      ...(init?.headers ?? {}),
      "Cache-Control": "private, max-age=8, stale-while-revalidate=12",
    },
  });
}

function shortAddress(address: string) {
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

function formatTokenAmount(value: bigint, decimals: number) {
  const raw = formatUnits(value, decimals);
  const [whole, fraction = ""] = raw.split(".");
  const trimmed = fraction.slice(0, 3).replace(/0+$/, "");
  return trimmed ? `${whole}.${trimmed}` : whole;
}

function formatTransferNumber(value: number) {
  if (!Number.isFinite(value) || value <= 0) return "0";
  if (value > 0 && value < 0.001) return "<0.001";
  const formatted = value.toLocaleString(undefined, { maximumFractionDigits: value >= 1000 ? 2 : 6 });
  return formatted.includes(".") ? formatted.replace(/\.?0+$/, "") : formatted;
}

function parseHexNumber(value: string | undefined) {
  if (!value) return 0;
  try {
    if (value.startsWith("0x")) return Number(BigInt(value));
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  } catch {
    return 0;
  }
}

function parseAlchemyDecimals(value: string | number | null | undefined) {
  if (typeof value === "number") return Number.isFinite(value) ? value : 18;
  if (!value) return 18;
  try {
    if (value.startsWith("0x")) return Number(BigInt(value));
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 18;
  } catch {
    return 18;
  }
}

function isValidActivityHash(value: string) {
  if (/^0x[a-fA-F0-9]{16,}$/.test(value)) return true;
  if (value.startsWith("0xmock")) return true;
  return /^[a-zA-Z0-9:_-]{8,160}$/.test(value);
}

async function getTokenMeta(address: Address) {
  const key = address.toLowerCase();
  const configured = ERC20_TOKENS.find((token) => token.contractAddress.toLowerCase() === key);
  if (configured) return { symbol: configured.symbol, decimals: configured.decimals };
  const swapConfigured = Object.values(VERIFIED_SWAP_TOKENS).find((token) => token.address.toLowerCase() === key);
  if (swapConfigured) return { symbol: swapConfigured.symbol, decimals: swapConfigured.decimals };
  const cached = tokenMetaCache.get(key);
  if (cached) return cached;

  try {
    const [symbol, decimals] = await Promise.all([
      publicClient.readContract({ address, abi: erc20MetaAbi, functionName: "symbol" }),
      publicClient.readContract({ address, abi: erc20MetaAbi, functionName: "decimals" }),
    ]);
    const meta = { symbol: String(symbol || "TOKEN").slice(0, 12), decimals: Number(decimals || 18) };
    tokenMetaCache.set(key, meta);
    return meta;
  } catch {
    return { symbol: "TOKEN", decimals: 18 };
  }
}

async function getBlockTime(blockNumber: bigint) {
  const key = blockNumber.toString();
  const cached = blockTimeCache.get(key);
  if (cached) return cached;

  try {
    const block = await publicClient.getBlock({ blockNumber });
    const iso = new Date(Number(block.timestamp) * 1000).toISOString();
    blockTimeCache.set(key, iso);
    return iso;
  } catch {
    const iso = new Date().toISOString();
    blockTimeCache.set(key, iso);
    return iso;
  }
}

async function getTransferLogsForAddress(address: Address, latest: bigint, direction: "in" | "out") {
  const minBlock = latest > activityLookbackBlocks ? latest - activityLookbackBlocks : 0n;
  const logs = [];

  for (let toBlock = latest; toBlock >= minBlock; ) {
    let fromBlock = toBlock > activityLogChunkBlocks ? toBlock - activityLogChunkBlocks + 1n : 0n;
    if (fromBlock < minBlock) fromBlock = minBlock;

    try {
      const chunks = await Promise.all(
        activityTokenAddresses.map((tokenAddress) =>
          publicClient
            .getLogs({
              address: tokenAddress,
              event: transferEvent,
              args: direction === "in" ? { to: address } : { from: address },
              fromBlock,
              toBlock,
            })
            .catch(() => {
              console.warn("[activity] token logs unavailable");
              return [];
            }),
        ),
      );
      logs.push(...chunks.flat());
    } catch {
      console.warn("[activity] log chunk unavailable");
    }

    if (fromBlock === 0n || fromBlock === minBlock) break;
    toBlock = fromBlock - 1n;
  }

  return logs;
}

async function getRecentPriorityTransferLogs(address: Address, latest: bigint, direction: "in" | "out") {
  const minBlock = latest > priorityActivityLookbackBlocks ? latest - priorityActivityLookbackBlocks : 0n;
  const logs = [];

  try {
    const chunks = await Promise.all(
      priorityActivityTokenAddresses.map((tokenAddress) =>
        publicClient
          .getLogs({
            address: tokenAddress,
            event: transferEvent,
            args: direction === "in" ? { to: address } : { from: address },
            fromBlock: minBlock,
            toBlock: latest,
          })
          .catch(() => {
            console.warn("[activity] priority logs unavailable");
            return [];
          }),
      ),
    );
    logs.push(...chunks.flat());
  } catch {
    console.warn("[activity] priority log chunk unavailable");
  }

  return logs;
}

async function getRecentUniversalTransferLogs(address: Address, latest: bigint, direction: "in" | "out") {
  const minBlock = latest > universalActivityLookbackBlocks ? latest - universalActivityLookbackBlocks : 0n;
  const logs = [];

  for (let toBlock = latest; toBlock >= minBlock; ) {
    let fromBlock = toBlock > universalActivityLogChunkBlocks ? toBlock - universalActivityLogChunkBlocks + 1n : 0n;
    if (fromBlock < minBlock) fromBlock = minBlock;

    try {
      const chunkLogs = await publicClient.getLogs({
        event: transferEvent,
        args: direction === "in" ? { to: address } : { from: address },
        fromBlock,
        toBlock,
      });
      logs.push(...chunkLogs);
    } catch {
      console.warn("[activity] universal logs unavailable");
    }

    if (fromBlock === 0n || fromBlock === minBlock) break;
    toBlock = fromBlock - 1n;
  }

  return logs;
}

async function withActivityTimeout<T>(promise: Promise<T>, fallbackValue: T, label: string, timeoutMs = ACTIVITY_CHAIN_TIMEOUT_MS) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((resolve) => {
        timer = setTimeout(() => {
          console.warn("[activity] source timed out", label, timeoutMs);
          resolve(fallbackValue);
        }, timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function fetchAlchemyAssetTransfers(address: Address, latest: bigint): Promise<ActivityTransferRow[]> {
  const minBlock = latest > activityLookbackBlocks ? latest - activityLookbackBlocks : 0n;
  const lower = address.toLowerCase();
  const rows: ActivityTransferRow[] = [];

  async function fetchDirection(direction: "in" | "out") {
    let pageKey: string | undefined;
    let pages = 0;
    do {
      const params: Record<string, unknown> = {
        fromBlock: `0x${minBlock.toString(16)}`,
        toBlock: "latest",
        category: ["external", "erc20"],
        withMetadata: true,
        excludeZeroValue: true,
        maxCount: "0x64",
        order: "desc",
      };
      if (direction === "in") params.toAddress = address;
      else params.fromAddress = address;
      if (pageKey) params.pageKey = pageKey;

      const response = await fetch(worldChainAlchemyRpc, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: `activity-${direction}-${pages}`,
          method: "alchemy_getAssetTransfers",
          params: [params],
        }),
        signal: AbortSignal.timeout(ACTIVITY_INDEXER_TIMEOUT_MS),
        next: { revalidate: 0 },
      });
      if (!response.ok) throw new Error(`Alchemy activity request failed: ${response.status}`);
      const payload = (await response.json()) as {
        result?: { transfers?: AlchemyAssetTransfer[]; pageKey?: string };
        error?: { message?: string };
      };
      if (payload.error) throw new Error(payload.error.message || "Alchemy activity request failed");

      for (const transfer of payload.result?.transfers ?? []) {
        const hash = String(transfer.hash || "");
        if (!/^0x[a-fA-F0-9]{16,}$/.test(hash)) continue;
        const from = String(transfer.from || "");
        const to = String(transfer.to || "");
        const incomingTx = to.toLowerCase() === lower;
        const outgoingTx = from.toLowerCase() === lower;
        if (!incomingTx && !outgoingTx) continue;

        const tokenAddress = transfer.rawContract?.address && isAddress(transfer.rawContract.address)
          ? transfer.rawContract.address as Address
          : null;
        const configuredMeta = tokenAddress ? await getTokenMeta(tokenAddress) : null;
        const symbol = String(configuredMeta?.symbol || transfer.asset || (transfer.category === "external" ? "ETH" : "TOKEN")).slice(0, 12);
        const decimals = configuredMeta?.decimals ?? parseAlchemyDecimals(transfer.rawContract?.decimal);
        let tokenText = "";
        let tokenAmount = 0;
        const rawValue = transfer.rawContract?.value;
        if (rawValue && /^0x[0-9a-fA-F]+$/.test(rawValue)) {
          const value = BigInt(rawValue);
          tokenAmount = Number(formatUnits(value, decimals));
          tokenText = `${formatTokenAmount(value, decimals)} ${symbol}`;
        } else {
          tokenAmount = Number(transfer.value || 0);
          tokenText = `${formatTransferNumber(tokenAmount)} ${symbol}`;
        }
        if (!Number.isFinite(tokenAmount) || tokenAmount <= 0) continue;

        const rowDirection: "in" | "out" = incomingTx ? "in" : "out";
        const blockNumber = parseHexNumber(transfer.blockNum);
        rows.push({
          hash: hash as `0x${string}`,
          type: rowDirection,
          title: incomingTx ? `Received ${symbol}` : `Sent ${symbol}`,
          subtitle: incomingTx ? `From ${shortAddress(from)}` : `To ${shortAddress(to)}`,
          amount: `${incomingTx ? "+" : "-"}${tokenText}`,
          tokenText,
          tokenAmount,
          direction: rowDirection,
          status: "Completed",
          createdAt: transfer.metadata?.blockTimestamp || new Date().toISOString(),
          blockNumber,
          logIndex: parseHexNumber(transfer.uniqueId?.split(":").pop()),
        });
      }

      pageKey = payload.result?.pageKey;
      pages += 1;
    } while (pageKey && pages < 3);
  }

  await Promise.all([fetchDirection("in"), fetchDirection("out")]);
  return rows;
}

function dedupeTransferRows(rows: ActivityTransferRow[]) {
  const seen = new Set<string>();
  return rows.filter((row) => {
    const key = `${row.hash}-${row.direction}-${row.tokenText}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export async function GET(req: NextRequest) {
  if (!rateLimit(req, "public:activity", 120).ok) {
    return activityResponse({ error: "Too many requests." }, { status: 429 });
  }

  const url = new URL(req.url);
  const address = url.searchParams.get("address") ?? "";
  const fast = url.searchParams.get("fast") === "1";
  if (!isAddress(address)) return activityResponse([]);
  const cacheKey = address.toLowerCase();
  const cached = activityCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) return activityResponse(cached.data);
  const storedRows = await getStoredActivities(80)
    .then((rows) =>
      rows
        .filter((row) => !row.address || row.address.toLowerCase() === address.toLowerCase())
        .map((row) => ({
          hash: row.hash,
          type: row.type === "swap" ? "swap" : row.type === "send" ? "out" : "in",
          title: row.type === "swap" ? "Swap" : row.type === "send" ? "Sent" : row.type === "earn" ? "Earn" : "Transaction",
          subtitle: row.type === "earn" ? "Vault" : row.type === "swap" ? "Swap" : "Wallet",
          amount: row.amount || "—",
          status: row.status === "completed" ? "Completed" : row.status,
          blockNumber: 0,
          logIndex: row.id,
          createdAt: row.createdAt.toISOString(),
        })),
    )
    .catch(() => []);

  if (fast) {
    return activityResponse(storedRows.slice(0, 80), {
      headers: { "Cache-Control": "private, no-store, max-age=0" },
    });
  }

  try {
    const latest = await publicClient.getBlockNumber();
    const lower = address.toLowerCase();
    const [universalIncoming, universalOutgoing, priorityIncoming, priorityOutgoing, incoming, outgoing, indexedTransfers] = await Promise.all([
      withActivityTimeout(getRecentUniversalTransferLogs(address as Address, latest, "in"), [], "incoming-universal-logs", ACTIVITY_CHAIN_TIMEOUT_MS),
      withActivityTimeout(getRecentUniversalTransferLogs(address as Address, latest, "out"), [], "outgoing-universal-logs", ACTIVITY_CHAIN_TIMEOUT_MS),
      withActivityTimeout(getRecentPriorityTransferLogs(address as Address, latest, "in"), [], "incoming-priority-logs", ACTIVITY_CHAIN_TIMEOUT_MS),
      withActivityTimeout(getRecentPriorityTransferLogs(address as Address, latest, "out"), [], "outgoing-priority-logs", ACTIVITY_CHAIN_TIMEOUT_MS),
      withActivityTimeout(getTransferLogsForAddress(address as Address, latest, "in"), [], "incoming-token-logs"),
      withActivityTimeout(getTransferLogsForAddress(address as Address, latest, "out"), [], "outgoing-token-logs"),
      fetchAlchemyAssetTransfers(address as Address, latest).catch(() => {
        console.warn("[activity] indexed transfers unavailable");
        return [] as ActivityTransferRow[];
      }),
    ]);
    const seen = new Set<string>();
    const logs: ActivityTransferRow[] = await Promise.all(
      [...universalIncoming, ...universalOutgoing, ...priorityIncoming, ...priorityOutgoing, ...incoming, ...outgoing]
        .filter((log) => {
          const value = log.args.value ?? 0n;
          if (value <= 0n) return false;
          const key = `${log.transactionHash}-${log.logIndex}`;
          if (seen.has(key)) return false;
          seen.add(key);
          return true;
        })
        .map(async (log) => {
          const from = String(log.args.from ?? "");
          const to = String(log.args.to ?? "");
          const incomingTx = to.toLowerCase() === lower;
          const direction: "in" | "out" = incomingTx ? "in" : "out";
          const value = log.args.value ?? 0n;
          const [meta, createdAt] = await Promise.all([getTokenMeta(log.address), getBlockTime(log.blockNumber)]);
          return {
            hash: log.transactionHash,
            type: direction,
            title: incomingTx ? `Received ${meta.symbol}` : `Sent ${meta.symbol}`,
            subtitle: incomingTx ? `From ${shortAddress(from)}` : `To ${shortAddress(to)}`,
            amount: `${incomingTx ? "+" : "-"}${formatTokenAmount(value, meta.decimals)} ${meta.symbol}`,
            tokenText: `${formatTokenAmount(value, meta.decimals)} ${meta.symbol}`,
            tokenAmount: Number(formatUnits(value, meta.decimals)),
            direction,
            status: "Completed",
            createdAt,
            blockNumber: Number(log.blockNumber),
            logIndex: Number(log.logIndex),
          };
        }),
    );

    const merged = mergeSwapActivity(dedupeTransferRows([...logs, ...indexedTransfers]));
    const allRows = [...storedRows, ...merged];
    allRows.sort((a, b) => {
      const at = "createdAt" in a ? new Date(String(a.createdAt)).getTime() : 0;
      const bt = "createdAt" in b ? new Date(String(b.createdAt)).getTime() : 0;
      return bt - at || b.blockNumber - a.blockNumber || b.logIndex - a.logIndex;
    });
    const output = allRows.slice(0, 80);
    activityCache.set(cacheKey, { data: output, expiresAt: Date.now() + ACTIVITY_CACHE_TTL_MS });
    return activityResponse(output);
  } catch {
    console.warn("[activity] real activity unavailable");
    return activityResponse(storedRows.slice(0, 80));
  }
}

export async function POST(req: NextRequest) {
  if (!rateLimit(req, "public:activity-write", 60).ok) {
    return jsonResponse({ error: "Too many requests." }, { status: 429 });
  }

  const body = (await req.json().catch(() => null)) as {
    type?: string;
    address?: string;
    amount?: string;
    hash?: string;
    status?: string;
    metadata?: unknown;
  } | null;
  const hash = String(body?.hash || "").trim();
  if (!isValidActivityHash(hash)) {
    return jsonResponse({ error: "Invalid transaction hash." }, { status: 400 });
  }

  const address = body?.address && isAddress(body.address) ? body.address : null;
  const type = String(body?.type || "transaction").slice(0, 40);
  const status = String(body?.status || "completed").slice(0, 40);
  const amount = body?.amount ? String(body.amount).slice(0, 140) : null;

  try {
    await recordActivity({ type, address, amount, hash, status, metadata: body?.metadata ?? {} });
    if (address) activityCache.delete(address.toLowerCase());
    return jsonResponse({ ok: true });
  } catch {
    console.warn("[activity] record failed");
    return jsonResponse({ error: "Failed to record activity." }, { status: 500 });
  }
}

function mergeSwapActivity<
  T extends {
    hash: `0x${string}`;
    type: string;
    title: string;
    subtitle: string;
    amount: string;
    tokenText: string;
    tokenAmount: number;
    direction: "in" | "out";
    status: string;
    createdAt: string;
    blockNumber: number;
    logIndex: number;
  },
>(logs: T[]) {
  const byHash = new Map<string, T[]>();
  for (const log of logs) {
    const rows = byHash.get(log.hash) ?? [];
    rows.push(log);
    byHash.set(log.hash, rows);
  }

  const rows: Array<Omit<T, "direction" | "tokenText" | "tokenAmount">> = [];
  for (const group of byHash.values()) {
    const outgoing = largestTransfer(group.filter((item) => item.direction === "out"));
    const incoming = largestTransfer(group.filter((item) => item.direction === "in"));
    if (outgoing && incoming && group.length >= 2) {
      const incomingSymbol = tokenSymbolFromText(incoming.tokenText);
      const outgoingSymbol = tokenSymbolFromText(outgoing.tokenText);
      const incomingIsVaultShare = isVaultShareSymbol(incomingSymbol);
      const outgoingIsVaultShare = isVaultShareSymbol(outgoingSymbol);
      const title = incomingIsVaultShare
        ? `Deposit ${outgoing.tokenText}`
        : outgoingIsVaultShare
          ? `Withdraw ${incoming.tokenText}`
          : `Swap ${compactActivityTokenText(outgoing.tokenText)} -${compactActivityTokenText(incoming.tokenText)}`;
      const subtitle = incomingIsVaultShare || outgoingIsVaultShare ? "Vault" : "Swap";
      const type = incomingIsVaultShare ? "in" : outgoingIsVaultShare ? "out" : "swap";
      rows.push({
        hash: outgoing.hash,
        type,
        title,
        subtitle,
        amount: `+${incoming.tokenText}`,
        status: "Completed",
        createdAt: newestCreatedAt(group),
        blockNumber: Math.max(...group.map((item) => item.blockNumber)),
        logIndex: Math.max(...group.map((item) => item.logIndex)),
      } as Omit<T, "direction" | "tokenText" | "tokenAmount">);
    } else {
      rows.push(...group.map(({ direction: _direction, tokenText: _tokenText, tokenAmount: _tokenAmount, ...item }) => item));
    }
  }
  return rows;
}

function compactActivityTokenText(value: string) {
  return String(value || "")
    .trim()
    .replace(/^([+-]?\d+(?:\.\d+)?)\s+([A-Za-z][A-Za-z0-9]{0,15})$/, "$1$2");
}

function newestCreatedAt<T extends { createdAt: string }>(items: T[]) {
  return items
    .map((item) => item.createdAt)
    .filter(Boolean)
    .sort((a, b) => new Date(b).getTime() - new Date(a).getTime())[0] ?? new Date().toISOString();
}

function largestTransfer<
  T extends {
    tokenAmount: number;
  },
>(items: T[]) {
  return items
    .filter((item) => Number.isFinite(item.tokenAmount) && item.tokenAmount > 0)
    .sort((a, b) => b.tokenAmount - a.tokenAmount)[0];
}

function tokenSymbolFromText(tokenText: string) {
  const parts = tokenText.trim().split(/\s+/);
  return parts[parts.length - 1] ?? "";
}

function isVaultShareSymbol(symbol: string) {
  return /^(re7|vault|morpho|moo)/i.test(symbol);
}
