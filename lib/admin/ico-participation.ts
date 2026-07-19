import type { Prisma } from "@prisma/client";
import { formatUnits, parseAbiItem, type Address } from "viem";
import { db } from "@/lib/db";
import { publicClient } from "@/lib/chain";
import { getSystemConfig } from "@/lib/admin/system-config";

const ICO_PARTICIPANTS_KEY = "ico_participants";
const ICO_TARGET_LUMINA = 450_000_000;
const ICO_BASE_PROGRESS_LUMINA = (288 * 1000) + (1.33 * 6000);
const ICO_DISPLAY_BASE_PERCENT = 70;
const ICO_TREASURY_ADDRESS = "0x600a84949f0f0023adf6ed89cccd2b2ceccf1077";
const ICO_CHAIN_LOOKBACK_BLOCKS = 20_000n;
const ICO_CHAIN_LOG_CHUNK_BLOCKS = 100n;
const ICO_EXPLORER_BASE_URL = process.env.WORLD_CHAIN_EXPLORER_API_URL || "https://worldchain-mainnet.explorer.alchemy.com/api/v2";
const ICO_EXPLORER_SYNC_AFTER = process.env.LUMINA_ICO_SYNC_AFTER || "2026-07-07T00:00:00.000Z";
const ICO_EXPLORER_MAX_PAGES = 80;
const ICO_ENABLE_RPC_SYNC = process.env.LUMINA_ICO_ENABLE_RPC_SYNC === "1";
const ICO_TOKEN_RATES: Record<string, number> = {
  WLD: 1000,
  USDC: 6000,
  ETH: 13_500_000,
  WETH: 13_500_000,
  BTC: 650_000_000,
  WBTC: 650_000_000,
};
const ICO_CHAIN_TOKENS = [
  { symbol: "WLD", address: "0x2cFc85d8E48F8EAB294be644d9E25C3030863003" as Address, decimals: 18 },
  { symbol: "USDC", address: "0x79A02482A880bCE3F13e09Da970dC34db4CD24d1" as Address, decimals: 6 },
  { symbol: "ETH", address: "0x4200000000000000000000000000000000000006" as Address, decimals: 18 },
  { symbol: "BTC", address: "0x03c7054bcb39f7b2e5b2c7acb37583e32d70cfa3" as Address, decimals: 8 },
];
const transferEvent = parseAbiItem("event Transfer(address indexed from, address indexed to, uint256 value)");

let lastChainSyncAt = 0;
let chainSyncPromise: Promise<IcoParticipationRecord[]> | null = null;

function displayIcoProgressPercent(rawPercent: number) {
  const pct = Math.max(0, Math.min(100, Number(rawPercent || 0)));
  return Math.max(ICO_DISPLAY_BASE_PERCENT, Math.min(100, ICO_DISPLAY_BASE_PERCENT + pct * ((100 - ICO_DISPLAY_BASE_PERCENT) / 100)));
}

async function getIcoTokenRates() {
  const rates = { ...ICO_TOKEN_RATES };
  const config = await getSystemConfig().catch(() => null);
  const tokens = config?.ico?.paymentTokens || [];
  for (const token of tokens) {
    const symbol = String(token.symbol || "").toUpperCase();
    const rate = Number(token.luminaRate || 0);
    if (!symbol || !Number.isFinite(rate) || rate <= 0) continue;
    rates[symbol] = rate;
    if (token.paySymbol) rates[String(token.paySymbol).toUpperCase()] = rate;
  }
  return rates;
}

function recalculateRecordLumina(row: IcoParticipationRecord, rates: Record<string, number>) {
  const symbol = String(row.tokenSymbol || "WLD").toUpperCase();
  const rate = rates[symbol] || ICO_TOKEN_RATES[symbol] || 0;
  return {
    ...row,
    tokenSymbol: symbol,
    luminaAmount: Math.max(0, Number(row.tokenAmount || 0) * rate),
  };
}

export type IcoParticipationRecord = {
  id: string;
  address: string;
  tokenSymbol: string;
  tokenAmount: number;
  luminaAmount: number;
  txHash?: string | null;
  createdAt: string;
};

function normalizeAddress(value: string) {
  const address = String(value || "").toLowerCase();
  if (!/^0x[a-f0-9]{40}$/.test(address)) throw new Error("Invalid wallet address.");
  return address;
}

function parseRecords(value: unknown): IcoParticipationRecord[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is Partial<IcoParticipationRecord> => !!item && typeof item === "object")
    .map((item): IcoParticipationRecord => ({
      id: String(item.id || `ico-${Date.now()}`),
      address: String(item.address || "").toLowerCase(),
      tokenSymbol: String(item.tokenSymbol || "WLD").toUpperCase().slice(0, 16),
      tokenAmount: Math.max(0, Number(item.tokenAmount || 0)),
      luminaAmount: Math.max(0, Number(item.luminaAmount || 0)),
      txHash: typeof item.txHash === "string" && item.txHash.trim() ? item.txHash.trim().slice(0, 140) : null,
      createdAt: String(item.createdAt || new Date().toISOString()),
    }))
    .filter((item) => /^0x[a-f0-9]{40}$/.test(item.address) && item.tokenAmount > 0);
}

async function readRecords() {
  const page = await db.contentPage.findUnique({ where: { key: ICO_PARTICIPANTS_KEY } });
  return parseRecords(page?.bodyI18n);
}

async function writeRecords(records: IcoParticipationRecord[]) {
  const trimmed = records.slice(0, 20000);
  await db.contentPage.upsert({
    where: { key: ICO_PARTICIPANTS_KEY },
    update: { bodyI18n: trimmed as unknown as Prisma.InputJsonValue },
    create: { key: ICO_PARTICIPANTS_KEY, bodyI18n: trimmed as unknown as Prisma.InputJsonValue },
  });
  return trimmed;
}

function parseActivityAmount(value: unknown, rates: Record<string, number>) {
  const match = String(value || "").match(/([0-9]+(?:\.[0-9]+)?)\s*([A-Za-z]+)/);
  if (!match) return null;
  const amount = Number(match[1]);
  const symbol = String(match[2] || "").toUpperCase();
  if (!Number.isFinite(amount) || amount <= 0 || !rates[symbol]) return null;
  return { amount, symbol };
}

type IcoActivityRow = {
  address: string | null;
  amount: string | null;
  hash: string;
  metadata: { tokenSymbol?: string; recipient?: string } | null;
  createdAt: Date;
};

type ExplorerTokenTransfer = {
  block_number?: number | string | null;
  log_index?: number | string | null;
  transaction_hash?: string | null;
  timestamp?: string | null;
  from?: { hash?: string | null } | null;
  to?: { hash?: string | null } | null;
  token?: { address_hash?: string | null; symbol?: string | null; decimals?: string | number | null } | null;
  total?: { value?: string | null; decimals?: string | number | null } | null;
};

type ExplorerTransfersResponse = {
  items?: ExplorerTokenTransfer[];
  next_page_params?: Record<string, string | number | null> | null;
};

async function syncIcoRecordsFromActivityLog() {
  const rates = await getIcoTokenRates();
  const rows = await readRecords();
  const known = new Set(rows.map((row) => String(row.txHash || "").toLowerCase()).filter(Boolean));
  const activities = await db
    .$queryRaw<IcoActivityRow[]>`
      SELECT "address", "amount", "hash", "metadata", "createdAt"
      FROM "ActivityLog"
      WHERE LOWER(COALESCE("metadata"->>'recipient', '')) = ${ICO_TREASURY_ADDRESS}
      ORDER BY "createdAt" DESC
    `
    .catch(() => [] as IcoActivityRow[]);

  const imported: IcoParticipationRecord[] = [];
  for (const activity of activities) {
    const hash = String(activity.hash || "").trim();
    if (!hash || known.has(hash.toLowerCase())) continue;
    const address = String(activity.address || "").toLowerCase();
    if (!/^0x[a-f0-9]{40}$/.test(address)) continue;
    const parsed = parseActivityAmount(activity.amount, rates);
    if (!parsed) continue;
    const metadataSymbol = String(activity.metadata?.tokenSymbol || "").toUpperCase();
    const tokenSymbol = rates[metadataSymbol] ? metadataSymbol : parsed.symbol;
    const tokenAmount = parsed.amount;
    imported.push({
      id: `ico-activity-${Date.now()}-${imported.length}`,
      address,
      tokenSymbol,
      tokenAmount,
      luminaAmount: tokenAmount * rates[tokenSymbol],
      txHash: hash,
      createdAt: activity.createdAt instanceof Date ? activity.createdAt.toISOString() : String(activity.createdAt || new Date().toISOString()),
    });
    known.add(hash.toLowerCase());
  }

  if (!imported.length) return rows;
  return writeRecords([...imported, ...rows]);
}

function tokenSymbolFromExplorerTransfer(item: ExplorerTokenTransfer, tokenByAddress: Map<string, { symbol: string; decimals: number }>) {
  const tokenAddress = String(item.token?.address_hash || "").toLowerCase();
  const byAddress = tokenByAddress.get(tokenAddress);
  const rawSymbol = String(item.token?.symbol || byAddress?.symbol || "").toUpperCase();
  if (rawSymbol === "WETH") return "ETH";
  if (rawSymbol === "WBTC") return "BTC";
  return rawSymbol || byAddress?.symbol || "";
}

function explorerTransferAmount(item: ExplorerTokenTransfer, fallbackDecimals: number) {
  const rawValue = String(item.total?.value || "").trim();
  if (!/^\d+$/.test(rawValue)) return 0;
  const decimals = Math.max(0, Math.min(36, Number(item.total?.decimals ?? item.token?.decimals ?? fallbackDecimals)));
  return Number(formatUnits(BigInt(rawValue), decimals));
}

function explorerNextUrl(baseUrl: string, nextPageParams: ExplorerTransfersResponse["next_page_params"]) {
  if (!nextPageParams) return null;
  const params = new URLSearchParams();
  Object.entries(nextPageParams).forEach(([key, value]) => {
    if (value !== null && value !== undefined) params.set(key, String(value));
  });
  const query = params.toString();
  return query ? `${baseUrl}&${query}` : null;
}

async function fetchExplorerTransfersPage(url: string) {
  const response = await fetch(url, {
    headers: { accept: "application/json" },
    signal: AbortSignal.timeout(8_000),
    cache: "no-store",
  });
  if (!response.ok) throw new Error(`Explorer ICO sync failed: HTTP ${response.status}`);
  return response.json() as Promise<ExplorerTransfersResponse>;
}

async function syncIcoRecordsFromExplorer(rows: IcoParticipationRecord[], rates: Record<string, number>) {
  const treasury = ICO_TREASURY_ADDRESS.toLowerCase();
  const syncAfter = Date.parse(ICO_EXPLORER_SYNC_AFTER);
  const tokenByAddress = new Map(
    ICO_CHAIN_TOKENS.map((token) => [token.address.toLowerCase(), { symbol: token.symbol, decimals: token.decimals }]),
  );
  const known = knownTxHashes(rows);
  const imported: IcoParticipationRecord[] = [];
  const baseUrl = `${ICO_EXPLORER_BASE_URL.replace(/\/$/, "")}/addresses/${treasury}/token-transfers?type=ERC-20`;
  let url: string | null = baseUrl;

  for (let page = 0; page < ICO_EXPLORER_MAX_PAGES && url; page += 1) {
    const data = await fetchExplorerTransfersPage(url);
    const items = Array.isArray(data.items) ? data.items : [];
    let reachedOlderRows = false;

    for (const item of items) {
      const createdAt = String(item.timestamp || new Date().toISOString());
      const createdMs = Date.parse(createdAt);
      if (Number.isFinite(syncAfter) && Number.isFinite(createdMs) && createdMs < syncAfter) {
        reachedOlderRows = true;
        continue;
      }
      const to = String(item.to?.hash || "").toLowerCase();
      if (to !== treasury) continue;
      const hash = String(item.transaction_hash || "").toLowerCase();
      if (!hash || known.has(hash)) continue;
      const from = String(item.from?.hash || "").toLowerCase();
      if (!/^0x[a-f0-9]{40}$/.test(from)) continue;
      const symbol = tokenSymbolFromExplorerTransfer(item, tokenByAddress);
      const fallbackDecimals = tokenByAddress.get(String(item.token?.address_hash || "").toLowerCase())?.decimals ?? 18;
      const rate = rates[symbol] || ICO_TOKEN_RATES[symbol] || 0;
      if (!symbol || rate <= 0) continue;
      const tokenAmount = explorerTransferAmount(item, fallbackDecimals);
      if (!Number.isFinite(tokenAmount) || tokenAmount <= 0) continue;
      imported.push({
        id: `ico-explorer-${item.block_number || Date.now()}-${item.log_index || imported.length}`,
        address: from,
        tokenSymbol: symbol,
        tokenAmount,
        luminaAmount: tokenAmount * rate,
        txHash: hash,
        createdAt,
      });
      known.add(hash);
    }

    if (reachedOlderRows) break;
    url = explorerNextUrl(baseUrl, data.next_page_params);
  }

  if (!imported.length) return rows;
  return writeRecords([...imported, ...rows]);
}

function knownTxHashes(rows: IcoParticipationRecord[]) {
  return new Set(rows.map((row) => String(row.txHash || "").toLowerCase().split(":")[0]).filter(Boolean));
}

function hasRealTransactionHash(row: IcoParticipationRecord) {
  return /^0x[a-f0-9]{64}$/i.test(String(row.txHash || ""));
}

function isChainSourcedRecord(row: IcoParticipationRecord) {
  return row.id.startsWith("ico-explorer-") || row.id.startsWith("ico-chain-");
}

function dedupeIcoRecords(rows: IcoParticipationRecord[]) {
  const seenTx = new Set<string>();
  const chainKeys = new Set<string>();
  const unique: IcoParticipationRecord[] = [];

  for (const row of rows) {
    const txHash = hasRealTransactionHash(row) ? String(row.txHash).toLowerCase() : "";
    if (txHash) {
      if (seenTx.has(txHash)) continue;
      seenTx.add(txHash);
    }
    if (isChainSourcedRecord(row)) chainKeys.add(`${row.address}:${row.tokenSymbol}`);
    unique.push(row);
  }

  return unique.filter((row) => {
    if (isChainSourcedRecord(row)) return true;
    return !chainKeys.has(`${row.address}:${row.tokenSymbol}`);
  });
}

async function syncIcoRecordsFromChain() {
  const startedAt = Date.now();
  if (chainSyncPromise) return chainSyncPromise;
  if (startedAt - lastChainSyncAt < 120_000) return syncIcoRecordsFromActivityLog();
  chainSyncPromise = (async () => {
    const rates = await getIcoTokenRates();
    let rows = await syncIcoRecordsFromActivityLog();
    rows = await syncIcoRecordsFromExplorer(rows, rates).catch(() => rows);
    if (!ICO_ENABLE_RPC_SYNC) {
      lastChainSyncAt = Date.now();
      return rows;
    }
    const known = knownTxHashes(rows);
    const latest = await publicClient.getBlockNumber();
    const minBlock = latest > ICO_CHAIN_LOOKBACK_BLOCKS ? latest - ICO_CHAIN_LOOKBACK_BLOCKS : 0n;
    const imported: IcoParticipationRecord[] = [];

    for (const token of ICO_CHAIN_TOKENS) {
      for (let fromBlock = minBlock; fromBlock <= latest; ) {
        const toBlock = fromBlock + ICO_CHAIN_LOG_CHUNK_BLOCKS > latest ? latest : fromBlock + ICO_CHAIN_LOG_CHUNK_BLOCKS;
        const logs = await publicClient
          .getLogs({
            address: token.address,
            event: transferEvent,
            args: { to: ICO_TREASURY_ADDRESS as Address },
            fromBlock,
            toBlock,
          })
          .catch(() => []);
        for (const log of logs) {
          const hash = String(log.transactionHash || "").toLowerCase();
          if (!hash || known.has(hash)) continue;
          const args = log.args as { from?: string; value?: bigint };
          const from = String(args.from || "").toLowerCase();
          const value = args.value ?? 0n;
          if (!/^0x[a-f0-9]{40}$/.test(from) || value <= 0n) continue;
          const tokenAmount = Number(formatUnits(value, token.decimals));
          if (!Number.isFinite(tokenAmount) || tokenAmount <= 0) continue;
          imported.push({
            id: `ico-chain-${Number(log.blockNumber || 0n)}-${Number(log.logIndex || 0)}`,
            address: from,
            tokenSymbol: token.symbol,
            tokenAmount,
            luminaAmount: tokenAmount * rates[token.symbol],
            txHash: hash,
            createdAt: new Date().toISOString(),
          });
          known.add(hash);
        }
        if (toBlock === latest) break;
        fromBlock = toBlock + 1n;
      }
    }

    if (imported.length) rows = await writeRecords([...imported, ...rows]);
    lastChainSyncAt = Date.now();
    return rows;
  })().finally(() => {
    chainSyncPromise = null;
  });
  return chainSyncPromise;
}

export async function recordIcoParticipation(input: {
  address: string;
  tokenSymbol: string;
  tokenAmount: number;
  luminaAmount: number;
  txHash?: string | null;
}) {
  const rates = await getIcoTokenRates();
  const address = normalizeAddress(input.address);
  const tokenAmount = Math.max(0, Number(input.tokenAmount || 0));
  if (tokenAmount <= 0) throw new Error("ICO amount required.");
  const tokenSymbol = String(input.tokenSymbol || "WLD").toUpperCase().slice(0, 16);
  const rate = rates[tokenSymbol] || ICO_TOKEN_RATES[tokenSymbol] || 0;
  if (rate <= 0) throw new Error("Unsupported ICO token.");
  const txHash = typeof input.txHash === "string" && input.txHash.trim() ? input.txHash.trim().slice(0, 140) : null;
  const rows = await readRecords();
  if (txHash) {
    const existing = rows.find((row) => row.address === address && row.txHash === txHash);
    if (existing) return existing;
  }
  const row: IcoParticipationRecord = {
    id: `ico-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    address,
    tokenSymbol,
    tokenAmount,
    luminaAmount: tokenAmount * rate,
    txHash,
    createdAt: new Date().toISOString(),
  };
  rows.unshift(row);
  await writeRecords(rows);
  return row;
}

export async function hasIcoParticipation(address: string) {
  const normalized = normalizeAddress(address);
  const rows = dedupeIcoRecords(await syncIcoRecordsFromChain());
  return rows.some((row) => row.address === normalized && row.tokenAmount > 0);
}

export async function assertIcoMysteryBoxEligibility(address: string) {
  if (!(await hasIcoParticipation(address))) {
    throw new Error("Join the LUMINA ICO first to unlock this mystery box.");
  }
}

export async function getIcoProgress(options: { sync?: boolean } = {}) {
  const rows = dedupeIcoRecords(options.sync === false ? await readRecords() : await syncIcoRecordsFromChain());
  const rates = await getIcoTokenRates();
  const normalizedRows = rows.map((row) => recalculateRecordLumina(row, rates));
  const recordedLumina = normalizedRows.reduce((sum, row) => sum + Math.max(0, Number(row.luminaAmount || 0)), 0);
  const raisedLumina = Math.max(0, ICO_BASE_PROGRESS_LUMINA + recordedLumina);
  const rawPercent = Math.max(0, Math.min(100, (raisedLumina / ICO_TARGET_LUMINA) * 100));
  const percent = displayIcoProgressPercent(rawPercent);
  return {
    targetLumina: ICO_TARGET_LUMINA,
    rawPercent,
    percent,
  };
}

export async function getIcoAdminOverview() {
  const rows = dedupeIcoRecords(await syncIcoRecordsFromChain());
  const rates = await getIcoTokenRates();
  const normalizedRows = rows.map((row) => recalculateRecordLumina(row, rates));
  const byAddress = new Map<string, { address: string; luminaAmount: number; tokenAmount: number; orders: number; lastAt: string | null }>();
  normalizedRows.forEach((row) => {
    const address = String(row.address || "").toLowerCase();
    if (!/^0x[a-f0-9]{40}$/.test(address)) return;
    const current = byAddress.get(address) || { address, luminaAmount: 0, tokenAmount: 0, orders: 0, lastAt: null };
    current.luminaAmount += Math.max(0, Number(row.luminaAmount || 0));
    current.tokenAmount += Math.max(0, Number(row.tokenAmount || 0));
    current.orders += 1;
    if (!current.lastAt || new Date(row.createdAt).getTime() > new Date(current.lastAt).getTime()) current.lastAt = row.createdAt;
    byAddress.set(address, current);
  });
  const leaderboard = Array.from(byAddress.values())
    .sort((a, b) => b.luminaAmount - a.luminaAmount || new Date(b.lastAt || 0).getTime() - new Date(a.lastAt || 0).getTime())
    .slice(0, 500);
  const progress = await getIcoProgress({ sync: false });
  return {
    stats: {
      participants: leaderboard.length,
      orders: normalizedRows.length,
      luminaAmount: normalizedRows.reduce((sum, row) => sum + Math.max(0, Number(row.luminaAmount || 0)), 0),
      percent: progress.percent,
      rawPercent: progress.rawPercent,
    },
    leaderboard,
  };
}
