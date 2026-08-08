CREATE TABLE "SupportConversation" (
    "id" SERIAL NOT NULL,
    "address" TEXT NOT NULL,
    "username" TEXT,
    "language" TEXT NOT NULL DEFAULT 'en',
    "status" TEXT NOT NULL DEFAULT 'open',
    "assignedTo" TEXT,
    "lastUserReadAt" TIMESTAMP(3),
    "lastAdminReadAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "SupportConversation_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "SupportMessage" (
    "id" SERIAL NOT NULL,
    "conversationId" INTEGER NOT NULL,
    "sender" TEXT NOT NULL,
    "senderName" TEXT,
    "text" TEXT,
    "imageUrl" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "SupportMessage_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "SupportConversation_address_updatedAt_idx" ON "SupportConversation"("address", "updatedAt");
CREATE INDEX "SupportConversation_status_updatedAt_idx" ON "SupportConversation"("status", "updatedAt");
CREATE INDEX "SupportConversation_assignedTo_updatedAt_idx" ON "SupportConversation"("assignedTo", "updatedAt");
CREATE INDEX "SupportMessage_conversationId_createdAt_idx" ON "SupportMessage"("conversationId", "createdAt");

ALTER TABLE "SupportMessage" ADD CONSTRAINT "SupportMessage_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "SupportConversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
