import { db } from "@/lib/db";

export const DEFAULT_FEE_CONFIGS = [
  { businessType: "swap", percent: "0.003", recipient: null },
  { businessType: "earn", percent: "0.005", recipient: null },
] as const;

let ensured: Promise<void> | null = null;

export function ensureFeeSchema() {
  ensured ??= db
    .$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS "FeeConfig" (
        "businessType" TEXT PRIMARY KEY,
        "percent" DECIMAL(5,4) NOT NULL,
        "recipient" TEXT,
        "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `)
    .then(() => undefined);
  return ensured;
}

export async function ensureDefaultFees() {
  await ensureFeeSchema();
  for (const fee of DEFAULT_FEE_CONFIGS) {
    await db.feeConfig.upsert({
      where: { businessType: fee.businessType },
      update: {},
      create: fee,
    });
  }
}
