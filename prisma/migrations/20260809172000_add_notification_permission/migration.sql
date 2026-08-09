ALTER TABLE "User"
ADD COLUMN "notificationsEnabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "notificationsUpdatedAt" TIMESTAMP(3);

CREATE INDEX "User_notificationsEnabled_notificationsUpdatedAt_idx"
ON "User"("notificationsEnabled", "notificationsUpdatedAt");
