import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";

const FEE_SHARE_RECORDS_KEY = "fee_share_participants";

export type FeeShareParticipationRecord = {
  id: string;
  address: string;
  amountWld: number;
  sharePercent: number;
  txHash: string | null;
  status: "pending_review";
  createdAt: string;
};

function normalizeAddress(value: unknown) {
  const address = String(value || "").toLowerCase();
  if (!/^0x[a-f0-9]{40}$/.test(address)) throw new Error("Invalid wallet address.");
  return address;
}

function parseRecords(value: unknown): FeeShareParticipationRecord[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is Partial<FeeShareParticipationRecord> => Boolean(item && typeof item === "object"))
    .map((item) => ({
      id: String(item.id || `fee-share-${Date.now()}`),
      address: String(item.address || "").toLowerCase(),
      amountWld: Math.max(0, Number(item.amountWld || 0)),
      sharePercent: Math.max(0, Number(item.sharePercent || 0)),
      txHash: typeof item.txHash === "string" && item.txHash.trim() ? item.txHash.trim().slice(0, 140) : null,
      status: "pending_review" as const,
      createdAt: String(item.createdAt || new Date(0).toISOString()),
    }))
    .filter((item) => /^0x[a-f0-9]{40}$/.test(item.address) && item.amountWld >= 100 && item.amountWld <= 1000);
}

async function readRecords() {
  const page = await db.contentPage.findUnique({ where: { key: FEE_SHARE_RECORDS_KEY } });
  return parseRecords(page?.bodyI18n);
}

export async function recordFeeShareParticipation(input: {
  address: string;
  amountWld: number;
  txHash?: string | null;
}) {
  const amountWld = Number(input.amountWld);
  if (!Number.isFinite(amountWld) || amountWld < 100 || amountWld > 1000 || amountWld % 100 !== 0) {
    throw new Error("Fee share amount must be 100 to 1,000 WLD in 100 WLD units.");
  }
  const address = normalizeAddress(input.address);
  const txHash = typeof input.txHash === "string" && input.txHash.trim() ? input.txHash.trim().slice(0, 140) : null;
  const existing = await readRecords();
  const duplicate = txHash && existing.some((row) => row.txHash === txHash);
  if (duplicate) return existing.find((row) => row.txHash === txHash) as FeeShareParticipationRecord;

  const record: FeeShareParticipationRecord = {
    id: `fee-share-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    address,
    amountWld,
    sharePercent: amountWld / 100,
    txHash,
    status: "pending_review",
    createdAt: new Date().toISOString(),
  };
  const next = [record, ...existing].slice(0, 20000);
  await db.contentPage.upsert({
    where: { key: FEE_SHARE_RECORDS_KEY },
    update: { bodyI18n: next as unknown as Prisma.InputJsonValue },
    create: { key: FEE_SHARE_RECORDS_KEY, bodyI18n: next as unknown as Prisma.InputJsonValue },
  });
  return record;
}

export async function getFeeShareParticipationRecords() {
  return readRecords();
}
