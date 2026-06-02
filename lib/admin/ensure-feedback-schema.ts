import { db } from "@/lib/db";

let ensured: Promise<void> | null = null;

export function ensureFeedbackSchema() {
  ensured ??= db
    .$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS "Feedback" (
        "id" SERIAL PRIMARY KEY,
        "address" TEXT,
        "username" TEXT,
        "contact" TEXT,
        "message" TEXT NOT NULL,
        "status" TEXT NOT NULL DEFAULT 'new',
        "reply" TEXT,
        "repliedAt" TIMESTAMP(3),
        "repliedBy" TEXT,
        "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
      ALTER TABLE "Feedback"
        ADD COLUMN IF NOT EXISTS "reply" TEXT,
        ADD COLUMN IF NOT EXISTS "repliedAt" TIMESTAMP(3),
        ADD COLUMN IF NOT EXISTS "repliedBy" TEXT
    `)
    .then(() => undefined);
  return ensured;
}
