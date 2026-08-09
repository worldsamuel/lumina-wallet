CREATE INDEX IF NOT EXISTS "User_createdAt_idx" ON "User"("createdAt");
CREATE INDEX IF NOT EXISTS "User_lastLoginAt_idx" ON "User"("lastLoginAt");

CREATE INDEX IF NOT EXISTS "Token_status_createdAt_idx" ON "Token"("status", "createdAt");
CREATE INDEX IF NOT EXISTS "Token_canSwap_status_idx" ON "Token"("canSwap", "status");
CREATE INDEX IF NOT EXISTS "Token_onTopRanking_status_idx" ON "Token"("onTopRanking", "status");

CREATE INDEX IF NOT EXISTS "Announcement_publishedAt_idx" ON "Announcement"("publishedAt");
CREATE INDEX IF NOT EXISTS "AuditLog_createdAt_idx" ON "AuditLog"("createdAt");
CREATE INDEX IF NOT EXISTS "Feedback_status_createdAt_idx" ON "Feedback"("status", "createdAt");
