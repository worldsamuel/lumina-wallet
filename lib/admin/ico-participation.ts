import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";

const ICO_PARTICIPANTS_KEY = "ico_participants";
const ICO_TARGET_LUMINA = 450_000_000;
const ICO_BASE_PROGRESS_LUMINA = (288 * 1000) + (1.33 * 6000);
const ICO_DISPLAY_BASE_PERCENT = 70;
const ICO_TREASURY_ADDRESS = "0x600a84949f0f0023adf6ed89cccd2b2ceccf1077";
const ICO_TOKEN_RATES: Record<string, number> = {
  WLD: 1000,
  USDC: 5000,
  ETH: 13_500_000,
  WETH: 13_500_000,
  BTC: 650_000_000,
  WBTC: 650_000_000,
};

function displayIcoProgressPercent(rawPercent: number) {
  const pct = Math.max(0, Math.min(100, Number(rawPercent || 0)));
  return Math.max(ICO_DISPLAY_BASE_PERCENT, Math.min(100, ICO_DISPLAY_BASE_PERCENT + pct * ((100 - ICO_DISPLAY_BASE_PERCENT) / 100)));
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

function parseActivityAmount(value: unknown) {
  const match = String(value || "").match(/([0-9]+(?:\.[0-9]+)?)\s*([A-Za-z]+)/);
  if (!match) return null;
  const amount = Number(match[1]);
  const symbol = String(match[2] || "").toUpperCase();
  if (!Number.isFinite(amount) || amount <= 0 || !ICO_TOKEN_RATES[symbol]) return null;
  return { amount, symbol };
}

type IcoActivityRow = {
  address: string | null;
  amount: string | null;
  hash: string;
  metadata: { tokenSymbol?: string; recipient?: string } | null;
  createdAt: Date;
};

async function syncIcoRecordsFromActivityLog() {
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
    const parsed = parseActivityAmount(activity.amount);
    if (!parsed) continue;
    const metadataSymbol = String(activity.metadata?.tokenSymbol || "").toUpperCase();
    const tokenSymbol = ICO_TOKEN_RATES[metadataSymbol] ? metadataSymbol : parsed.symbol;
    const tokenAmount = parsed.amount;
    imported.push({
      id: `ico-activity-${Date.now()}-${imported.length}`,
      address,
      tokenSymbol,
      tokenAmount,
      luminaAmount: tokenAmount * ICO_TOKEN_RATES[tokenSymbol],
      txHash: hash,
      createdAt: activity.createdAt instanceof Date ? activity.createdAt.toISOString() : String(activity.createdAt || new Date().toISOString()),
    });
    known.add(hash.toLowerCase());
  }

  if (!imported.length) return rows;
  return writeRecords([...imported, ...rows]);
}

export async function recordIcoParticipation(input: {
  address: string;
  tokenSymbol: string;
  tokenAmount: number;
  luminaAmount: number;
  txHash?: string | null;
}) {
  const address = normalizeAddress(input.address);
  const tokenAmount = Math.max(0, Number(input.tokenAmount || 0));
  if (tokenAmount <= 0) throw new Error("ICO amount required.");
  const tokenSymbol = String(input.tokenSymbol || "WLD").toUpperCase().slice(0, 16);
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
    luminaAmount: Math.max(0, Number(input.luminaAmount || 0)),
    txHash,
    createdAt: new Date().toISOString(),
  };
  rows.unshift(row);
  await writeRecords(rows);
  return row;
}

export async function hasIcoParticipation(address: string) {
  const normalized = normalizeAddress(address);
  const rows = await syncIcoRecordsFromActivityLog();
  return rows.some((row) => row.address === normalized && row.tokenAmount > 0);
}

export async function assertIcoMysteryBoxEligibility(address: string) {
  if (!(await hasIcoParticipation(address))) {
    throw new Error("Join the LUMINA ICO first to unlock this mystery box.");
  }
}

export async function getIcoProgress() {
  const rows = await syncIcoRecordsFromActivityLog();
  const recordedLumina = rows.reduce((sum, row) => sum + Math.max(0, Number(row.luminaAmount || 0)), 0);
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
  const rows = await syncIcoRecordsFromActivityLog();
  const byAddress = new Map<string, { address: string; luminaAmount: number; tokenAmount: number; orders: number; lastAt: string | null }>();
  rows.forEach((row) => {
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
  const progress = await getIcoProgress();
  return {
    stats: {
      participants: leaderboard.length,
      orders: rows.length,
      luminaAmount: rows.reduce((sum, row) => sum + Math.max(0, Number(row.luminaAmount || 0)), 0),
      percent: progress.percent,
      rawPercent: progress.rawPercent,
    },
    leaderboard,
  };
}
