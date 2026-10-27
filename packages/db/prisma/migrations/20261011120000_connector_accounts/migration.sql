-- CreateTable
CREATE TABLE "connector_accounts" (
    "id" TEXT NOT NULL,
    "spaceId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "connectorId" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT NOT NULL DEFAULT '',
    "scopes" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "status" TEXT NOT NULL DEFAULT 'active',
    "lastError" TEXT,
    "secretId" TEXT,
    "refreshedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "connector_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "connector_authorizations" (
    "id" TEXT NOT NULL,
    "stateHash" TEXT NOT NULL,
    "spaceId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "connectorId" TEXT NOT NULL,
    "connectionId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "scopes" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "ciphertext" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "connector_authorizations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "connector_activities" (
    "id" TEXT NOT NULL,
    "spaceId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "connectorId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "accountId" TEXT,
    "action" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "error" TEXT,
    "detail" TEXT,
    "runId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "connector_activities_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "connector_accounts_secretId_key" ON "connector_accounts"("secretId");

-- CreateIndex
CREATE UNIQUE INDEX "connector_accounts_spaceId_userId_connectorId_subject_key" ON "connector_accounts"("spaceId", "userId", "connectorId", "subject");

-- CreateIndex
CREATE UNIQUE INDEX "connector_authorizations_stateHash_key" ON "connector_authorizations"("stateHash");

-- CreateIndex
CREATE INDEX "connector_authorizations_spaceId_userId_createdAt_idx" ON "connector_authorizations"("spaceId", "userId", "createdAt");

-- CreateIndex
CREATE INDEX "connector_authorizations_expiresAt_idx" ON "connector_authorizations"("expiresAt");

-- CreateIndex
CREATE INDEX "connector_activities_spaceId_userId_connectorId_provider_cr_idx" ON "connector_activities"("spaceId", "userId", "connectorId", "provider", "createdAt");

-- CreateIndex
CREATE INDEX "connector_activities_createdAt_idx" ON "connector_activities"("createdAt");

-- AddForeignKey
ALTER TABLE "connector_accounts" ADD CONSTRAINT "connector_accounts_spaceId_fkey" FOREIGN KEY ("spaceId") REFERENCES "spaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "connector_accounts" ADD CONSTRAINT "connector_accounts_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "connector_accounts" ADD CONSTRAINT "connector_accounts_secretId_fkey" FOREIGN KEY ("secretId") REFERENCES "secrets"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "connector_authorizations" ADD CONSTRAINT "connector_authorizations_spaceId_fkey" FOREIGN KEY ("spaceId") REFERENCES "spaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "connector_activities" ADD CONSTRAINT "connector_activities_spaceId_fkey" FOREIGN KEY ("spaceId") REFERENCES "spaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

