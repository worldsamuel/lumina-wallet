import { db } from "@/lib/db";

let ensured: Promise<void> | null = null;

export function ensureTokenControlColumns() {
  ensured ??= db
    .$executeRawUnsafe(`
      ALTER TABLE "Token"
        ADD COLUMN IF NOT EXISTS "tier" TEXT NOT NULL DEFAULT 'community',
        ADD COLUMN IF NOT EXISTS "canTransfer" BOOLEAN NOT NULL DEFAULT true,
        ADD COLUMN IF NOT EXISTS "canSwap" BOOLEAN NOT NULL DEFAULT true
    `)
    .then(() => undefined);
  return ensured;
}
