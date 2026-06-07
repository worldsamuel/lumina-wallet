import { NextRequest } from "next/server";
import { formatUnits, isAddress, parseAbi, parseAbiItem, type Address } from "viem";
import { jsonResponse, optionsResponse } from "@/lib/api/cors";
import { rateLimit } from "@/lib/api/rate-limit";
import { getStoredActivities, recordActivity } from "@/lib/admin/activity-store";
import { publicClient } from "@/lib/chain";
import { ERC20_TOKENS } from "@/lib/tokens";

const transferEvent = parseAbiItem("event Transfer(address indexed from, address indexed to, uint256 value)");
const erc20MetaAbi = parseAbi(["function symbol() view returns (string)", "function decimals() view returns (uint8)"]);
const tokenMetaCache = new Map<string, { symbol: string; decimals: number }>();
const blockTimeCache = new Map<string, string>();

export function OPTIONS() {
  return optionsResponse();
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

function isValidActivityHash(value: string) {
  if (/^0x[a-fA-F0-9]{16,}$/.test(value)) return true;
  if (value.startsWith("0xmock")) return true;
  return /^[a-zA-Z0-9:_-]{8,160}$/.test(value);
}

async function getTokenMeta(address: Address) {
  const key = address.toLowerCase();
  const configured = ERC20_TOKENS.find((token) => token.contractAddress.toLowerCase() === key);
  if (configured) return { symbol: configured.symbol, decimals: configured.decimals };
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

export async function GET(req: NextRequest) {
  if (!rateLimit(req, "public:activity", 120).ok) {
    return jsonResponse({ error: "Too many requests." }, { status: 429 });
  }

  const url = new URL(req.url);
  const address = url.searchParams.get("address") ?? "";
  if (!isAddress(address)) return jsonResponse([]);
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

  try {
    const latest = await publicClient.getBlockNumber();
    const fromBlock = latest > 1_000_000n ? latest - 1_000_000n : 0n;
    const lower = address.toLowerCase();
    const [incoming, outgoing] = await Promise.all([
      publicClient.getLogs({
        event: transferEvent,
        args: { to: address as Address },
        fromBlock,
        toBlock: "latest",
      }),
      publicClient.getLogs({
        event: transferEvent,
        args: { from: address as Address },
        fromBlock,
        toBlock: "latest",
      }),
    ]);
    const seen = new Set<string>();
    const logs = await Promise.all(
      [...incoming, ...outgoing]
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
            logIndex: log.logIndex,
          };
        }),
    );

    const merged = mergeSwapActivity(logs);
    const allRows = [...storedRows, ...merged];
    allRows.sort((a, b) => {
      const at = "createdAt" in a ? new Date(String(a.createdAt)).getTime() : 0;
      const bt = "createdAt" in b ? new Date(String(b.createdAt)).getTime() : 0;
      return bt - at || b.blockNumber - a.blockNumber || b.logIndex - a.logIndex;
    });
    return jsonResponse(allRows.slice(0, 80));
  } catch (error) {
    console.error("Failed to fetch real activity", error);
    return jsonResponse(storedRows.slice(0, 80));
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
    return jsonResponse({ ok: true });
  } catch (error) {
    console.error("Failed to record activity", error);
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
          : `Swap ${outgoing.tokenText} → ${incoming.tokenText}`;
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
