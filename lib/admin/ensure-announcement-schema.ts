import { db } from "@/lib/db";

let ensured: Promise<void> | null = null;

export function ensureAnnouncementSchema() {
  ensured ??= db
    .$executeRawUnsafe(`
      ALTER TABLE "Announcement"
        ADD COLUMN IF NOT EXISTS "imageUrl" TEXT,
        ADD COLUMN IF NOT EXISTS "pinned" BOOLEAN NOT NULL DEFAULT false
    `)
    .then(() => undefined);
  return ensured;
}
