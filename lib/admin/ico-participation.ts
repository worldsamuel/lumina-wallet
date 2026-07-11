import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";

const ICO_PARTICIPANTS_KEY = "ico_participants";

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
  const rows = await readRecords();
  return rows.some((row) => row.address === normalized && row.tokenAmount > 0);
}

export async function assertIcoMysteryBoxEligibility(address: string) {
  if (!(await hasIcoParticipation(address))) {
    throw new Error("Join the LUMINA ICO first to unlock this mystery box.");
  }
}
