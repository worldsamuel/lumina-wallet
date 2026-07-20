import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";

const SECURITY_BACKUP_RECORDS_KEY = "security_backup_records";

export type SecurityBackupRecord = {
  address: string;
  username?: string | null;
  backedUp: boolean;
  backedUpAt: string;
  userAgent?: string | null;
};

const SENSITIVE_KEY_RE = /(mnemonic|private.?key|seed|phrase|recovery|secret)/i;

export function containsSensitiveBackupMaterial(value: unknown): boolean {
  if (!value || typeof value !== "object") return false;
  if (Array.isArray(value)) return value.some(containsSensitiveBackupMaterial);
  return Object.entries(value as Record<string, unknown>).some(([key, child]) => {
    if (SENSITIVE_KEY_RE.test(key)) return true;
    return containsSensitiveBackupMaterial(child);
  });
}

export async function getSecurityBackupRecords(): Promise<SecurityBackupRecord[]> {
  const page = await db.contentPage.findUnique({ where: { key: SECURITY_BACKUP_RECORDS_KEY } });
  const rows = page?.bodyI18n;
  if (!Array.isArray(rows)) return [];
  return rows
    .map((item) => normalizeRecord(item))
    .filter((item): item is SecurityBackupRecord => Boolean(item));
}

export async function saveSecurityBackupRecord(input: {
  address: string;
  username?: string | null;
  backedUp?: boolean;
  userAgent?: string | null;
}) {
  const address = input.address.toLowerCase();
  const now = new Date().toISOString();
  const existing = await getSecurityBackupRecords();
  const nextRecord: SecurityBackupRecord = {
    address,
    username: cleanText(input.username, 80),
    backedUp: input.backedUp !== false,
    backedUpAt: now,
    userAgent: cleanText(input.userAgent, 200),
  };
  const merged = [
    nextRecord,
    ...existing.filter((row) => row.address.toLowerCase() !== address),
  ].slice(0, 10000);

  await db.contentPage.upsert({
    where: { key: SECURITY_BACKUP_RECORDS_KEY },
    update: { bodyI18n: merged as unknown as Prisma.InputJsonValue },
    create: { key: SECURITY_BACKUP_RECORDS_KEY, bodyI18n: merged as unknown as Prisma.InputJsonValue },
  });

  return nextRecord;
}

function normalizeRecord(value: unknown): SecurityBackupRecord | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Partial<SecurityBackupRecord>;
  const address = String(row.address || "").toLowerCase();
  if (!/^0x[a-f0-9]{40}$/.test(address)) return null;
  const backedUpAt = String(row.backedUpAt || "");
  return {
    address,
    username: cleanText(row.username, 80),
    backedUp: row.backedUp !== false,
    backedUpAt: Number.isFinite(Date.parse(backedUpAt)) ? backedUpAt : new Date(0).toISOString(),
    userAgent: cleanText(row.userAgent, 200),
  };
}

function cleanText(value: unknown, max: number) {
  const text = String(value ?? "").trim();
  return text ? text.slice(0, max) : null;
}
