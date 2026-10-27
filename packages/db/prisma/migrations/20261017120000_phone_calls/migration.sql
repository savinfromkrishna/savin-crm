-- CreateTable
CREATE TABLE "phone_calls" (
    "id" TEXT NOT NULL,
    "operationKey" TEXT NOT NULL,
    "providerKey" TEXT NOT NULL,
    "spaceId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "botId" TEXT NOT NULL,
    "threadId" TEXT NOT NULL,
    "messageId" TEXT,
    "remoteId" TEXT,
    "to" TEXT NOT NULL,
    "from" TEXT,
    "purpose" TEXT NOT NULL,
    "brief" JSONB NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'queued',
    "endReason" TEXT,
    "transcript" JSONB NOT NULL DEFAULT '[]',
    "summary" TEXT,
    "startedAt" TIMESTAMP(3),
    "endedAt" TIMESTAMP(3),
    "durationSec" INTEGER,
    "maxDurationSec" INTEGER NOT NULL DEFAULT 600,
    "agentTokenHash" TEXT,
    "placeDispatched" BOOLEAN NOT NULL DEFAULT false,
    "hangupRequested" BOOLEAN NOT NULL DEFAULT false,
    "woken" BOOLEAN NOT NULL DEFAULT false,
    "version" INTEGER NOT NULL DEFAULT 0,
    "leaseToken" TEXT,
    "leaseExpiresAt" TIMESTAMP(3),
    "nextPollAt" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP,
    "errorCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "phone_calls_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "phone_calls_operationKey_key" ON "phone_calls"("operationKey");

-- CreateIndex
CREATE INDEX "phone_calls_providerKey_nextPollAt_idx" ON "phone_calls"("providerKey", "nextPollAt");

-- CreateIndex
CREATE INDEX "phone_calls_spaceId_userId_id_idx" ON "phone_calls"("spaceId", "userId", "id");

-- CreateIndex
CREATE INDEX "phone_calls_botId_createdAt_idx" ON "phone_calls"("botId", "createdAt");
