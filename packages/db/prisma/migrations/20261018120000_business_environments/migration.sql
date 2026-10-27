-- CreateTable
CREATE TABLE "business_environments" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "provider" TEXT NOT NULL DEFAULT 'frappe',
    "blueprintId" TEXT NOT NULL,
    "blueprintVersion" INTEGER NOT NULL,
    "siteUrl" TEXT NOT NULL,
    "siteName" TEXT NOT NULL,
    "companyName" TEXT NOT NULL,
    "companyAbbr" TEXT NOT NULL,
    "country" TEXT NOT NULL,
    "currency" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "installedApps" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "credentialSecretId" TEXT,
    "credentialCiphertext" TEXT,
    "webhookSecretId" TEXT,
    "webhookSecretCiphertext" TEXT,
    "lastVerifiedAt" TIMESTAMP(3),
    "lastError" TEXT,
    "createdByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "business_environments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "business_operations" (
    "id" TEXT NOT NULL,
    "environmentId" TEXT NOT NULL,
    "spaceId" TEXT NOT NULL,
    "actionId" TEXT NOT NULL,
    "actionVersion" INTEGER NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "actorUserId" TEXT,
    "actorBotId" TEXT,
    "runId" TEXT,
    "request" JSONB NOT NULL,
    "result" JSONB,
    "errorCode" TEXT,
    "errorMessage" TEXT,
    "externalDoctype" TEXT,
    "externalName" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "business_operations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "business_record_mappings" (
    "id" TEXT NOT NULL,
    "environmentId" TEXT NOT NULL,
    "recordType" TEXT NOT NULL,
    "legacyId" TEXT NOT NULL,
    "externalDoctype" TEXT NOT NULL,
    "externalName" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "business_record_mappings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "business_webhook_deliveries" (
    "id" TEXT NOT NULL,
    "environmentId" TEXT NOT NULL,
    "deliveryId" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "business_webhook_deliveries_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "business_environments_organizationId_key" ON "business_environments"("organizationId");

-- CreateIndex
CREATE INDEX "business_operations_environmentId_status_updatedAt_idx" ON "business_operations"("environmentId", "status", "updatedAt");

-- CreateIndex
CREATE INDEX "business_operations_spaceId_createdAt_idx" ON "business_operations"("spaceId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "business_operations_environmentId_idempotencyKey_key" ON "business_operations"("environmentId", "idempotencyKey");

-- CreateIndex
CREATE INDEX "business_record_mappings_environmentId_externalDoctype_exte_idx" ON "business_record_mappings"("environmentId", "externalDoctype", "externalName");

-- CreateIndex
CREATE UNIQUE INDEX "business_record_mappings_environmentId_recordType_legacyId_key" ON "business_record_mappings"("environmentId", "recordType", "legacyId");

-- CreateIndex
CREATE INDEX "business_webhook_deliveries_environmentId_receivedAt_idx" ON "business_webhook_deliveries"("environmentId", "receivedAt");

-- CreateIndex
CREATE UNIQUE INDEX "business_webhook_deliveries_environmentId_deliveryId_key" ON "business_webhook_deliveries"("environmentId", "deliveryId");

-- AddForeignKey
ALTER TABLE "business_environments" ADD CONSTRAINT "business_environments_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "business_operations" ADD CONSTRAINT "business_operations_environmentId_fkey" FOREIGN KEY ("environmentId") REFERENCES "business_environments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "business_record_mappings" ADD CONSTRAINT "business_record_mappings_environmentId_fkey" FOREIGN KEY ("environmentId") REFERENCES "business_environments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "business_webhook_deliveries" ADD CONSTRAINT "business_webhook_deliveries_environmentId_fkey" FOREIGN KEY ("environmentId") REFERENCES "business_environments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

