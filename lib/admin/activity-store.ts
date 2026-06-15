import { db } from "@/lib/db";

type ActivityInput = {
  type: string;
  address?: string | null;
  amount?: string | null;
  hash: string;
  status?: string | null;
  metadata?: unknown;
};

type ActivityDbRow = {
  id: number;
  type: string;
  address: string | null;
  amount: string | null;
  hash: string;
  status: string;
  metadata: unknown;
  createdAt: Date;
};

let ensured: Promise<void> | null = null;

export function ensureActivityLogTable() {
  ensured ??= db
    .$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS "ActivityLog" (
        "id" SERIAL PRIMARY KEY,
        "type" TEXT NOT NULL,
        "address" TEXT,
        "amount" TEXT,
        "hash" TEXT NOT NULL UNIQUE,
        "status" TEXT NOT NULL DEFAULT 'completed',
        "metadata" JSONB,
        "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `)
    .then(() => undefined);
  return ensured;
}

export async function recordActivity(input: ActivityInput) {
  await ensureActivityLogTable();
  const metadata = JSON.stringify(input.metadata ?? {});
  await db.$executeRaw`
    INSERT INTO "ActivityLog" ("type", "address", "amount", "hash", "status", "metadata")
    VALUES (${input.type}, ${input.address ?? null}, ${input.amount ?? null}, ${input.hash}, ${input.status ?? "completed"}, ${metadata}::jsonb)
    ON CONFLICT ("hash") DO UPDATE SET
      "type" = EXCLUDED."type",
      "address" = COALESCE(EXCLUDED."address", "ActivityLog"."address"),
      "amount" = COALESCE(EXCLUDED."amount", "ActivityLog"."amount"),
      "status" = EXCLUDED."status",
      "metadata" = EXCLUDED."metadata"
  `;
}

export async function getStoredActivities(limit = 120) {
  await ensureActivityLogTable();
  const rows = await db.$queryRaw<ActivityDbRow[]>`
    SELECT "id", "type", "address", "amount", "hash", "status", "metadata", "createdAt"
    FROM "ActivityLog"
    ORDER BY "createdAt" DESC
    LIMIT ${limit}
  `;
  return rows;
}

export async function getStoredActivitiesForAddress(address: string, limit = 120) {
  await ensureActivityLogTable();
  const lower = address.toLowerCase();
  const rows = await db.$queryRaw<ActivityDbRow[]>`
    SELECT "id", "type", "address", "amount", "hash", "status", "metadata", "createdAt"
    FROM "ActivityLog"
    WHERE LOWER(COALESCE("address", '')) = ${lower}
    ORDER BY "createdAt" DESC
    LIMIT ${limit}
  `;
  return rows;
}

export async function countStoredActivities(since?: Date) {
  await ensureActivityLogTable();
  const rows = since
    ? await db.$queryRaw<Array<{ count: bigint }>>`
        SELECT COUNT(*)::bigint AS count
        FROM "ActivityLog"
        WHERE "createdAt" >= ${since}
      `
    : await db.$queryRaw<Array<{ count: bigint }>>`
        SELECT COUNT(*)::bigint AS count
        FROM "ActivityLog"
      `;
  return Number(rows[0]?.count || 0n);
}
