ALTER TABLE "SupportConversation" ADD COLUMN "accessTokenHash" TEXT;

CREATE INDEX "SupportConversation_address_accessTokenHash_idx"
ON "SupportConversation"("address", "accessTokenHash");
