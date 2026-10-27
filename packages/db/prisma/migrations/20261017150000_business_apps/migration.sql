-- CreateTable
CREATE TABLE "business_settings" (
    "id" TEXT NOT NULL,
    "spaceId" TEXT NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "allowNegativeStock" BOOLEAN NOT NULL DEFAULT false,
    "orderApprovalRequired" BOOLEAN NOT NULL DEFAULT true,
    "invoiceApprovalRequired" BOOLEAN NOT NULL DEFAULT true,
    "nextLeadNumber" INTEGER NOT NULL DEFAULT 1,
    "nextDealNumber" INTEGER NOT NULL DEFAULT 1,
    "nextOrderNumber" INTEGER NOT NULL DEFAULT 1,
    "nextInvoiceNumber" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "business_settings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "crm_companies" (
    "id" TEXT NOT NULL,
    "spaceId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "domain" TEXT,
    "phone" TEXT,
    "notes" TEXT,
    "createdByUserId" TEXT,
    "createdByBotId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "crm_companies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "crm_contacts" (
    "id" TEXT NOT NULL,
    "spaceId" TEXT NOT NULL,
    "firstName" TEXT NOT NULL,
    "lastName" TEXT NOT NULL DEFAULT '',
    "email" TEXT,
    "phone" TEXT,
    "title" TEXT,
    "notes" TEXT,
    "companyId" TEXT,
    "createdByUserId" TEXT,
    "createdByBotId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "crm_contacts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "crm_leads" (
    "id" TEXT NOT NULL,
    "spaceId" TEXT NOT NULL,
    "number" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'new',
    "source" TEXT,
    "notes" TEXT,
    "value" DECIMAL(14,2),
    "companyId" TEXT,
    "contactId" TEXT,
    "assigneeUserId" TEXT,
    "assigneeBotId" TEXT,
    "convertedDealId" TEXT,
    "createdByUserId" TEXT,
    "createdByBotId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "crm_leads_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "crm_deals" (
    "id" TEXT NOT NULL,
    "spaceId" TEXT NOT NULL,
    "number" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "stage" TEXT NOT NULL DEFAULT 'qualification',
    "amount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "expectedCloseAt" TIMESTAMP(3),
    "closedAt" TIMESTAMP(3),
    "notes" TEXT,
    "companyId" TEXT,
    "contactId" TEXT,
    "ownerUserId" TEXT,
    "ownerBotId" TEXT,
    "createdByUserId" TEXT,
    "createdByBotId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "crm_deals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "crm_activities" (
    "id" TEXT NOT NULL,
    "spaceId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "body" TEXT,
    "dueAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "companyId" TEXT,
    "contactId" TEXT,
    "leadId" TEXT,
    "dealId" TEXT,
    "assigneeUserId" TEXT,
    "assigneeBotId" TEXT,
    "createdByUserId" TEXT,
    "createdByBotId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "crm_activities_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "erp_products" (
    "id" TEXT NOT NULL,
    "spaceId" TEXT NOT NULL,
    "sku" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "unitPrice" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "stockOnHand" INTEGER NOT NULL DEFAULT 0,
    "createdByUserId" TEXT,
    "createdByBotId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "erp_products_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "erp_inventory_adjustments" (
    "id" TEXT NOT NULL,
    "spaceId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "delta" INTEGER NOT NULL,
    "quantityAfter" INTEGER NOT NULL,
    "reason" TEXT NOT NULL,
    "orderId" TEXT,
    "createdByUserId" TEXT,
    "createdByBotId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "erp_inventory_adjustments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "erp_sales_orders" (
    "id" TEXT NOT NULL,
    "spaceId" TEXT NOT NULL,
    "number" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "subtotal" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "notes" TEXT,
    "companyId" TEXT,
    "contactId" TEXT,
    "dealId" TEXT,
    "approvalRequestedAt" TIMESTAMP(3),
    "approvedAt" TIMESTAMP(3),
    "approvedByUserId" TEXT,
    "approvedByBotId" TEXT,
    "confirmedAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),
    "createdByUserId" TEXT,
    "createdByBotId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "erp_sales_orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "erp_sales_order_lines" (
    "id" TEXT NOT NULL,
    "spaceId" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "description" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "unitPrice" DECIMAL(14,2) NOT NULL,
    "lineTotal" DECIMAL(14,2) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "erp_sales_order_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "erp_invoices" (
    "id" TEXT NOT NULL,
    "spaceId" TEXT NOT NULL,
    "number" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "paymentStatus" TEXT NOT NULL DEFAULT 'unpaid',
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "subtotal" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "total" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "amountPaid" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "notes" TEXT,
    "orderId" TEXT NOT NULL,
    "companyId" TEXT,
    "issuedAt" TIMESTAMP(3),
    "dueAt" TIMESTAMP(3),
    "paidAt" TIMESTAMP(3),
    "approvedByUserId" TEXT,
    "approvedByBotId" TEXT,
    "createdByUserId" TEXT,
    "createdByBotId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "erp_invoices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "erp_invoice_lines" (
    "id" TEXT NOT NULL,
    "spaceId" TEXT NOT NULL,
    "invoiceId" TEXT NOT NULL,
    "productId" TEXT,
    "position" INTEGER NOT NULL,
    "description" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "unitPrice" DECIMAL(14,2) NOT NULL,
    "lineTotal" DECIMAL(14,2) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "erp_invoice_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "business_action_log" (
    "id" TEXT NOT NULL,
    "spaceId" TEXT NOT NULL,
    "actionId" TEXT NOT NULL,
    "actionVersion" INTEGER NOT NULL,
    "idempotencyKey" TEXT,
    "recordType" TEXT,
    "recordId" TEXT,
    "actorUserId" TEXT,
    "actorBotId" TEXT,
    "runId" TEXT,
    "outcome" TEXT NOT NULL,
    "errorCode" TEXT,
    "input" JSONB NOT NULL,
    "result" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "business_action_log_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "business_events" (
    "id" TEXT NOT NULL,
    "spaceId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "recordType" TEXT NOT NULL,
    "recordId" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "actorUserId" TEXT,
    "actorBotId" TEXT,
    "runId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "publishedAt" TIMESTAMP(3),

    CONSTRAINT "business_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "business_settings_spaceId_key" ON "business_settings"("spaceId");

-- CreateIndex
CREATE INDEX "crm_companies_spaceId_name_idx" ON "crm_companies"("spaceId", "name");

-- CreateIndex
CREATE INDEX "crm_contacts_spaceId_email_idx" ON "crm_contacts"("spaceId", "email");

-- CreateIndex
CREATE INDEX "crm_contacts_spaceId_companyId_idx" ON "crm_contacts"("spaceId", "companyId");

-- CreateIndex
CREATE INDEX "crm_contacts_spaceId_lastName_firstName_idx" ON "crm_contacts"("spaceId", "lastName", "firstName");

-- CreateIndex
CREATE UNIQUE INDEX "crm_leads_convertedDealId_key" ON "crm_leads"("convertedDealId");

-- CreateIndex
CREATE INDEX "crm_leads_spaceId_status_updatedAt_idx" ON "crm_leads"("spaceId", "status", "updatedAt");

-- CreateIndex
CREATE INDEX "crm_leads_spaceId_assigneeBotId_idx" ON "crm_leads"("spaceId", "assigneeBotId");

-- CreateIndex
CREATE INDEX "crm_leads_spaceId_assigneeUserId_idx" ON "crm_leads"("spaceId", "assigneeUserId");

-- CreateIndex
CREATE UNIQUE INDEX "crm_leads_spaceId_number_key" ON "crm_leads"("spaceId", "number");

-- CreateIndex
CREATE INDEX "crm_deals_spaceId_stage_updatedAt_idx" ON "crm_deals"("spaceId", "stage", "updatedAt");

-- CreateIndex
CREATE INDEX "crm_deals_spaceId_companyId_idx" ON "crm_deals"("spaceId", "companyId");

-- CreateIndex
CREATE UNIQUE INDEX "crm_deals_spaceId_number_key" ON "crm_deals"("spaceId", "number");

-- CreateIndex
CREATE INDEX "crm_activities_spaceId_createdAt_idx" ON "crm_activities"("spaceId", "createdAt");

-- CreateIndex
CREATE INDEX "crm_activities_spaceId_leadId_idx" ON "crm_activities"("spaceId", "leadId");

-- CreateIndex
CREATE INDEX "crm_activities_spaceId_dealId_idx" ON "crm_activities"("spaceId", "dealId");

-- CreateIndex
CREATE INDEX "crm_activities_spaceId_contactId_idx" ON "crm_activities"("spaceId", "contactId");

-- CreateIndex
CREATE INDEX "crm_activities_spaceId_completedAt_dueAt_idx" ON "crm_activities"("spaceId", "completedAt", "dueAt");

-- CreateIndex
CREATE INDEX "erp_products_spaceId_active_name_idx" ON "erp_products"("spaceId", "active", "name");

-- CreateIndex
CREATE UNIQUE INDEX "erp_products_spaceId_sku_key" ON "erp_products"("spaceId", "sku");

-- CreateIndex
CREATE INDEX "erp_inventory_adjustments_spaceId_productId_createdAt_idx" ON "erp_inventory_adjustments"("spaceId", "productId", "createdAt");

-- CreateIndex
CREATE INDEX "erp_inventory_adjustments_spaceId_createdAt_idx" ON "erp_inventory_adjustments"("spaceId", "createdAt");

-- CreateIndex
CREATE INDEX "erp_sales_orders_spaceId_status_updatedAt_idx" ON "erp_sales_orders"("spaceId", "status", "updatedAt");

-- CreateIndex
CREATE INDEX "erp_sales_orders_spaceId_companyId_idx" ON "erp_sales_orders"("spaceId", "companyId");

-- CreateIndex
CREATE INDEX "erp_sales_orders_spaceId_dealId_idx" ON "erp_sales_orders"("spaceId", "dealId");

-- CreateIndex
CREATE UNIQUE INDEX "erp_sales_orders_spaceId_number_key" ON "erp_sales_orders"("spaceId", "number");

-- CreateIndex
CREATE INDEX "erp_sales_order_lines_orderId_position_idx" ON "erp_sales_order_lines"("orderId", "position");

-- CreateIndex
CREATE INDEX "erp_sales_order_lines_spaceId_productId_idx" ON "erp_sales_order_lines"("spaceId", "productId");

-- CreateIndex
CREATE UNIQUE INDEX "erp_invoices_orderId_key" ON "erp_invoices"("orderId");

-- CreateIndex
CREATE INDEX "erp_invoices_spaceId_status_updatedAt_idx" ON "erp_invoices"("spaceId", "status", "updatedAt");

-- CreateIndex
CREATE INDEX "erp_invoices_spaceId_paymentStatus_idx" ON "erp_invoices"("spaceId", "paymentStatus");

-- CreateIndex
CREATE UNIQUE INDEX "erp_invoices_spaceId_number_key" ON "erp_invoices"("spaceId", "number");

-- CreateIndex
CREATE INDEX "erp_invoice_lines_invoiceId_position_idx" ON "erp_invoice_lines"("invoiceId", "position");

-- CreateIndex
CREATE INDEX "business_action_log_spaceId_recordType_recordId_createdAt_idx" ON "business_action_log"("spaceId", "recordType", "recordId", "createdAt");

-- CreateIndex
CREATE INDEX "business_action_log_spaceId_createdAt_idx" ON "business_action_log"("spaceId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "business_action_log_spaceId_idempotencyKey_key" ON "business_action_log"("spaceId", "idempotencyKey");

-- CreateIndex
CREATE INDEX "business_events_spaceId_createdAt_idx" ON "business_events"("spaceId", "createdAt");

-- CreateIndex
CREATE INDEX "business_events_publishedAt_createdAt_idx" ON "business_events"("publishedAt", "createdAt");

-- AddForeignKey
ALTER TABLE "business_settings" ADD CONSTRAINT "business_settings_spaceId_fkey" FOREIGN KEY ("spaceId") REFERENCES "spaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crm_companies" ADD CONSTRAINT "crm_companies_spaceId_fkey" FOREIGN KEY ("spaceId") REFERENCES "spaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crm_contacts" ADD CONSTRAINT "crm_contacts_spaceId_fkey" FOREIGN KEY ("spaceId") REFERENCES "spaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crm_contacts" ADD CONSTRAINT "crm_contacts_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "crm_companies"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crm_leads" ADD CONSTRAINT "crm_leads_spaceId_fkey" FOREIGN KEY ("spaceId") REFERENCES "spaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crm_leads" ADD CONSTRAINT "crm_leads_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "crm_companies"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crm_leads" ADD CONSTRAINT "crm_leads_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "crm_contacts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crm_leads" ADD CONSTRAINT "crm_leads_convertedDealId_fkey" FOREIGN KEY ("convertedDealId") REFERENCES "crm_deals"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crm_deals" ADD CONSTRAINT "crm_deals_spaceId_fkey" FOREIGN KEY ("spaceId") REFERENCES "spaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crm_deals" ADD CONSTRAINT "crm_deals_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "crm_companies"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crm_deals" ADD CONSTRAINT "crm_deals_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "crm_contacts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crm_activities" ADD CONSTRAINT "crm_activities_spaceId_fkey" FOREIGN KEY ("spaceId") REFERENCES "spaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crm_activities" ADD CONSTRAINT "crm_activities_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "crm_companies"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crm_activities" ADD CONSTRAINT "crm_activities_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "crm_contacts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crm_activities" ADD CONSTRAINT "crm_activities_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "crm_leads"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crm_activities" ADD CONSTRAINT "crm_activities_dealId_fkey" FOREIGN KEY ("dealId") REFERENCES "crm_deals"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "erp_products" ADD CONSTRAINT "erp_products_spaceId_fkey" FOREIGN KEY ("spaceId") REFERENCES "spaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "erp_inventory_adjustments" ADD CONSTRAINT "erp_inventory_adjustments_spaceId_fkey" FOREIGN KEY ("spaceId") REFERENCES "spaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "erp_inventory_adjustments" ADD CONSTRAINT "erp_inventory_adjustments_productId_fkey" FOREIGN KEY ("productId") REFERENCES "erp_products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "erp_inventory_adjustments" ADD CONSTRAINT "erp_inventory_adjustments_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "erp_sales_orders"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "erp_sales_orders" ADD CONSTRAINT "erp_sales_orders_spaceId_fkey" FOREIGN KEY ("spaceId") REFERENCES "spaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "erp_sales_orders" ADD CONSTRAINT "erp_sales_orders_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "crm_companies"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "erp_sales_orders" ADD CONSTRAINT "erp_sales_orders_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "crm_contacts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "erp_sales_orders" ADD CONSTRAINT "erp_sales_orders_dealId_fkey" FOREIGN KEY ("dealId") REFERENCES "crm_deals"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "erp_sales_order_lines" ADD CONSTRAINT "erp_sales_order_lines_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "erp_sales_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "erp_sales_order_lines" ADD CONSTRAINT "erp_sales_order_lines_productId_fkey" FOREIGN KEY ("productId") REFERENCES "erp_products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "erp_invoices" ADD CONSTRAINT "erp_invoices_spaceId_fkey" FOREIGN KEY ("spaceId") REFERENCES "spaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "erp_invoices" ADD CONSTRAINT "erp_invoices_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "erp_sales_orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "erp_invoices" ADD CONSTRAINT "erp_invoices_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "crm_companies"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "erp_invoice_lines" ADD CONSTRAINT "erp_invoice_lines_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "erp_invoices"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "erp_invoice_lines" ADD CONSTRAINT "erp_invoice_lines_productId_fkey" FOREIGN KEY ("productId") REFERENCES "erp_products"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "business_action_log" ADD CONSTRAINT "business_action_log_spaceId_fkey" FOREIGN KEY ("spaceId") REFERENCES "spaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "business_events" ADD CONSTRAINT "business_events_spaceId_fkey" FOREIGN KEY ("spaceId") REFERENCES "spaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;
