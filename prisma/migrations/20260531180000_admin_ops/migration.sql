-- Add production analytics events for admin dashboard open/visit metrics.
CREATE TABLE "AnalyticsEvent" (
    "id" SERIAL NOT NULL,
    "event" TEXT NOT NULL,
    "path" TEXT,
    "address" TEXT,
    "userAgent" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AnalyticsEvent_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "AnalyticsEvent_event_createdAt_idx" ON "AnalyticsEvent"("event", "createdAt");
CREATE INDEX "AnalyticsEvent_address_createdAt_idx" ON "AnalyticsEvent"("address", "createdAt");
