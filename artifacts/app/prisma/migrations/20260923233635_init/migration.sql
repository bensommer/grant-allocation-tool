-- CreateEnum
CREATE TYPE "SourceSystem" AS ENUM ('csv', 'qbo');

-- CreateEnum
CREATE TYPE "ImportStatus" AS ENUM ('running', 'succeeded', 'failed');

-- CreateEnum
CREATE TYPE "AccountType" AS ENUM ('Income', 'Expense', 'Asset', 'Liability', 'Equity', 'COGS', 'OtherExpense', 'OtherIncome');

-- CreateEnum
CREATE TYPE "PartyKind" AS ENUM ('customer', 'project', 'vendor', 'employee');

-- CreateEnum
CREATE TYPE "TxnType" AS ENUM ('Bill', 'Expense', 'Check', 'JournalEntry', 'Deposit', 'Invoice', 'SalesReceipt', 'Payroll', 'CreditCardCredit', 'VendorCredit');

-- CreateEnum
CREATE TYPE "PostingType" AS ENUM ('debit', 'credit');

-- CreateEnum
CREATE TYPE "FunctionalCategory" AS ENUM ('program', 'management_general', 'fundraising');

-- CreateEnum
CREATE TYPE "RestrictionType" AS ENUM ('purpose', 'time', 'both', 'unrestricted');

-- CreateEnum
CREATE TYPE "GrantStatus" AS ENUM ('draft', 'active', 'closed', 'archived');

-- CreateEnum
CREATE TYPE "AllocationMethod" AS ENUM ('fixed_pct', 'ratio_of_driver');

-- CreateEnum
CREATE TYPE "RunStatus" AS ENUM ('running', 'succeeded', 'failed', 'superseded');

-- CreateEnum
CREATE TYPE "AllocatedStatus" AS ENUM ('ok', 'allocation_conflict', 'crosswalk_conflict', 'unassigned_program');

-- CreateEnum
CREATE TYPE "NarrativeStatus" AS ENUM ('draft', 'approved');

-- CreateTable
CREATE TABLE "Org" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "fiscalYearStartMonth" INTEGER NOT NULL DEFAULT 1,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "settings" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Org_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ImportBatch" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "sourceSystem" "SourceSystem" NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),
    "status" "ImportStatus" NOT NULL DEFAULT 'running',
    "rangeFrom" TIMESTAMP(3),
    "rangeTo" TIMESTAMP(3),
    "fullRange" BOOLEAN NOT NULL DEFAULT true,
    "counts" JSONB NOT NULL DEFAULT '{}',
    "errors" JSONB NOT NULL DEFAULT '[]',
    "fileHashes" JSONB NOT NULL DEFAULT '{}',

    CONSTRAINT "ImportBatch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Account" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "sourceSystem" "SourceSystem" NOT NULL,
    "externalId" TEXT NOT NULL,
    "importBatchId" TEXT NOT NULL,
    "importedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "contentHash" TEXT NOT NULL DEFAULT '',
    "deletedAt" TIMESTAMP(3),
    "number" TEXT,
    "name" TEXT NOT NULL,
    "type" "AccountType" NOT NULL,
    "detailType" TEXT,
    "parentExternalId" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "Account_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TrackingClass" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "sourceSystem" "SourceSystem" NOT NULL,
    "externalId" TEXT NOT NULL,
    "importBatchId" TEXT NOT NULL,
    "importedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "contentHash" TEXT NOT NULL DEFAULT '',
    "deletedAt" TIMESTAMP(3),
    "name" TEXT NOT NULL,
    "parentExternalId" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "TrackingClass_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TrackingLocation" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "sourceSystem" "SourceSystem" NOT NULL,
    "externalId" TEXT NOT NULL,
    "importBatchId" TEXT NOT NULL,
    "importedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "contentHash" TEXT NOT NULL DEFAULT '',
    "deletedAt" TIMESTAMP(3),
    "name" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "TrackingLocation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Party" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "sourceSystem" "SourceSystem" NOT NULL,
    "externalId" TEXT NOT NULL,
    "importBatchId" TEXT NOT NULL,
    "importedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "contentHash" TEXT NOT NULL DEFAULT '',
    "deletedAt" TIMESTAMP(3),
    "kind" "PartyKind" NOT NULL,
    "displayName" TEXT NOT NULL,
    "parentExternalId" TEXT,

    CONSTRAINT "Party_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Transaction" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "sourceSystem" "SourceSystem" NOT NULL,
    "externalId" TEXT NOT NULL,
    "importBatchId" TEXT NOT NULL,
    "importedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "contentHash" TEXT NOT NULL DEFAULT '',
    "deletedAt" TIMESTAMP(3),
    "txnType" "TxnType" NOT NULL,
    "txnDate" DATE NOT NULL,
    "docNumber" TEXT,
    "memo" TEXT,
    "partyId" TEXT,
    "paymentAccountExternalId" TEXT,
    "totalCents" INTEGER NOT NULL,

    CONSTRAINT "Transaction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TransactionLine" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "transactionId" TEXT NOT NULL,
    "lineNumber" INTEGER NOT NULL,
    "accountId" TEXT NOT NULL,
    "classId" TEXT,
    "locationId" TEXT,
    "partyId" TEXT,
    "description" TEXT,
    "amountCents" INTEGER NOT NULL,
    "postingType" "PostingType" NOT NULL,

    CONSTRAINT "TransactionLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SourceRowVersion" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "entity" TEXT NOT NULL,
    "externalId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "hash" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "importBatchId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SourceRowVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Program" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "functionalCategory" "FunctionalCategory" NOT NULL DEFAULT 'program',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "matchClassIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Program_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Grant" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "funder" TEXT NOT NULL,
    "funderPartyId" TEXT,
    "awardNumber" TEXT,
    "startDate" DATE NOT NULL,
    "endDate" DATE NOT NULL,
    "awardAmountCents" INTEGER NOT NULL,
    "restrictionType" "RestrictionType" NOT NULL DEFAULT 'purpose',
    "status" "GrantStatus" NOT NULL DEFAULT 'active',
    "revenueAccountId" TEXT,
    "matchPartyIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "matchClassIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Grant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GrantProgram" (
    "grantId" TEXT NOT NULL,
    "programId" TEXT NOT NULL,
    "plannedShareBps" INTEGER,

    CONSTRAINT "GrantProgram_pkey" PRIMARY KEY ("grantId","programId")
);

-- CreateTable
CREATE TABLE "GrantBudgetLine" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "grantId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "budgetCents" INTEGER NOT NULL,
    "programId" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "GrantBudgetLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CrosswalkRule" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "name" TEXT,
    "matchers" JSONB NOT NULL,
    "grantBudgetLineId" TEXT NOT NULL,
    "priority" INTEGER NOT NULL DEFAULT 100,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CrosswalkRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AllocationRule" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "matchers" JSONB NOT NULL,
    "method" "AllocationMethod" NOT NULL DEFAULT 'fixed_pct',
    "driverKey" TEXT,
    "priority" INTEGER NOT NULL DEFAULT 100,
    "effectiveFrom" DATE,
    "effectiveTo" DATE,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AllocationRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AllocationTarget" (
    "id" TEXT NOT NULL,
    "allocationRuleId" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL,
    "programId" TEXT,
    "grantBudgetLineId" TEXT,
    "shareBps" INTEGER NOT NULL,

    CONSTRAINT "AllocationTarget_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AllocationDriverValue" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "driverKey" TEXT NOT NULL,
    "period" TEXT NOT NULL,
    "programId" TEXT NOT NULL,
    "value" INTEGER NOT NULL,

    CONSTRAINT "AllocationDriverValue_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ComputeRun" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),
    "status" "RunStatus" NOT NULL DEFAULT 'running',
    "configHash" TEXT NOT NULL,
    "sourceBatchIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "warnings" JSONB NOT NULL DEFAULT '[]',
    "checks" JSONB NOT NULL DEFAULT '[]',
    "stale" BOOLEAN NOT NULL DEFAULT false,
    "isCurrent" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "ComputeRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AllocatedLine" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "computeRunId" TEXT NOT NULL,
    "sourceLineId" TEXT NOT NULL,
    "pieceIndex" INTEGER NOT NULL,
    "allocationRuleId" TEXT,
    "crosswalkRuleId" TEXT,
    "programId" TEXT,
    "grantId" TEXT,
    "grantBudgetLineId" TEXT,
    "amountCents" INTEGER NOT NULL,
    "status" "AllocatedStatus" NOT NULL DEFAULT 'ok',
    "conflictRuleIds" TEXT[] DEFAULT ARRAY[]::TEXT[],

    CONSTRAINT "AllocatedLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditEvent" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "entity" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "before" JSONB,
    "after" JSONB,
    "actor" TEXT NOT NULL DEFAULT 'local-user',
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SavedView" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "path" TEXT NOT NULL,
    "queryString" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SavedView_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PeriodLock" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "periodFrom" DATE NOT NULL,
    "periodTo" DATE NOT NULL,
    "lockedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "computeRunId" TEXT NOT NULL,
    "note" TEXT,

    CONSTRAINT "PeriodLock_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Narrative" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "grantId" TEXT NOT NULL,
    "computeRunId" TEXT NOT NULL,
    "template" TEXT NOT NULL,
    "promptVersion" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "periodFrom" DATE NOT NULL,
    "periodTo" DATE NOT NULL,
    "contextNotes" TEXT,
    "packetJson" JSONB NOT NULL,
    "draftJson" JSONB NOT NULL,
    "editedJson" JSONB,
    "verification" JSONB NOT NULL DEFAULT '[]',
    "status" "NarrativeStatus" NOT NULL DEFAULT 'draft',
    "approvedBy" TEXT,
    "approvedAt" TIMESTAMP(3),
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Narrative_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ImportBatch_orgId_startedAt_idx" ON "ImportBatch"("orgId", "startedAt");

-- CreateIndex
CREATE INDEX "Account_orgId_type_idx" ON "Account"("orgId", "type");

-- CreateIndex
CREATE UNIQUE INDEX "Account_orgId_sourceSystem_externalId_key" ON "Account"("orgId", "sourceSystem", "externalId");

-- CreateIndex
CREATE UNIQUE INDEX "TrackingClass_orgId_sourceSystem_externalId_key" ON "TrackingClass"("orgId", "sourceSystem", "externalId");

-- CreateIndex
CREATE UNIQUE INDEX "TrackingLocation_orgId_sourceSystem_externalId_key" ON "TrackingLocation"("orgId", "sourceSystem", "externalId");

-- CreateIndex
CREATE UNIQUE INDEX "Party_orgId_sourceSystem_externalId_key" ON "Party"("orgId", "sourceSystem", "externalId");

-- CreateIndex
CREATE INDEX "Transaction_orgId_txnDate_idx" ON "Transaction"("orgId", "txnDate");

-- CreateIndex
CREATE UNIQUE INDEX "Transaction_orgId_sourceSystem_externalId_key" ON "Transaction"("orgId", "sourceSystem", "externalId");

-- CreateIndex
CREATE INDEX "TransactionLine_orgId_accountId_idx" ON "TransactionLine"("orgId", "accountId");

-- CreateIndex
CREATE INDEX "TransactionLine_orgId_classId_idx" ON "TransactionLine"("orgId", "classId");

-- CreateIndex
CREATE UNIQUE INDEX "TransactionLine_transactionId_lineNumber_key" ON "TransactionLine"("transactionId", "lineNumber");

-- CreateIndex
CREATE UNIQUE INDEX "SourceRowVersion_orgId_entity_externalId_version_key" ON "SourceRowVersion"("orgId", "entity", "externalId", "version");

-- CreateIndex
CREATE UNIQUE INDEX "Program_orgId_code_key" ON "Program"("orgId", "code");

-- CreateIndex
CREATE INDEX "Grant_orgId_status_idx" ON "Grant"("orgId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "GrantBudgetLine_grantId_code_key" ON "GrantBudgetLine"("grantId", "code");

-- CreateIndex
CREATE INDEX "CrosswalkRule_orgId_active_idx" ON "CrosswalkRule"("orgId", "active");

-- CreateIndex
CREATE INDEX "AllocationRule_orgId_active_idx" ON "AllocationRule"("orgId", "active");

-- CreateIndex
CREATE INDEX "AllocationTarget_allocationRuleId_idx" ON "AllocationTarget"("allocationRuleId");

-- CreateIndex
CREATE UNIQUE INDEX "AllocationDriverValue_orgId_driverKey_period_programId_key" ON "AllocationDriverValue"("orgId", "driverKey", "period", "programId");

-- CreateIndex
CREATE INDEX "ComputeRun_orgId_startedAt_idx" ON "ComputeRun"("orgId", "startedAt");

-- CreateIndex
CREATE INDEX "AllocatedLine_computeRunId_programId_idx" ON "AllocatedLine"("computeRunId", "programId");

-- CreateIndex
CREATE INDEX "AllocatedLine_computeRunId_grantId_idx" ON "AllocatedLine"("computeRunId", "grantId");

-- CreateIndex
CREATE INDEX "AllocatedLine_computeRunId_grantBudgetLineId_idx" ON "AllocatedLine"("computeRunId", "grantBudgetLineId");

-- CreateIndex
CREATE UNIQUE INDEX "AllocatedLine_computeRunId_sourceLineId_pieceIndex_key" ON "AllocatedLine"("computeRunId", "sourceLineId", "pieceIndex");

-- CreateIndex
CREATE INDEX "AuditEvent_orgId_entity_entityId_idx" ON "AuditEvent"("orgId", "entity", "entityId");

-- CreateIndex
CREATE INDEX "AuditEvent_orgId_at_idx" ON "AuditEvent"("orgId", "at");

-- CreateIndex
CREATE INDEX "Narrative_grantId_idx" ON "Narrative"("grantId");

-- AddForeignKey
ALTER TABLE "Account" ADD CONSTRAINT "Account_importBatchId_fkey" FOREIGN KEY ("importBatchId") REFERENCES "ImportBatch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TrackingClass" ADD CONSTRAINT "TrackingClass_importBatchId_fkey" FOREIGN KEY ("importBatchId") REFERENCES "ImportBatch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TrackingLocation" ADD CONSTRAINT "TrackingLocation_importBatchId_fkey" FOREIGN KEY ("importBatchId") REFERENCES "ImportBatch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Party" ADD CONSTRAINT "Party_importBatchId_fkey" FOREIGN KEY ("importBatchId") REFERENCES "ImportBatch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Transaction" ADD CONSTRAINT "Transaction_importBatchId_fkey" FOREIGN KEY ("importBatchId") REFERENCES "ImportBatch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Transaction" ADD CONSTRAINT "Transaction_partyId_fkey" FOREIGN KEY ("partyId") REFERENCES "Party"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TransactionLine" ADD CONSTRAINT "TransactionLine_transactionId_fkey" FOREIGN KEY ("transactionId") REFERENCES "Transaction"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TransactionLine" ADD CONSTRAINT "TransactionLine_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TransactionLine" ADD CONSTRAINT "TransactionLine_classId_fkey" FOREIGN KEY ("classId") REFERENCES "TrackingClass"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TransactionLine" ADD CONSTRAINT "TransactionLine_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "TrackingLocation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TransactionLine" ADD CONSTRAINT "TransactionLine_partyId_fkey" FOREIGN KEY ("partyId") REFERENCES "Party"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SourceRowVersion" ADD CONSTRAINT "SourceRowVersion_importBatchId_fkey" FOREIGN KEY ("importBatchId") REFERENCES "ImportBatch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GrantProgram" ADD CONSTRAINT "GrantProgram_grantId_fkey" FOREIGN KEY ("grantId") REFERENCES "Grant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GrantProgram" ADD CONSTRAINT "GrantProgram_programId_fkey" FOREIGN KEY ("programId") REFERENCES "Program"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GrantBudgetLine" ADD CONSTRAINT "GrantBudgetLine_grantId_fkey" FOREIGN KEY ("grantId") REFERENCES "Grant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GrantBudgetLine" ADD CONSTRAINT "GrantBudgetLine_programId_fkey" FOREIGN KEY ("programId") REFERENCES "Program"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CrosswalkRule" ADD CONSTRAINT "CrosswalkRule_grantBudgetLineId_fkey" FOREIGN KEY ("grantBudgetLineId") REFERENCES "GrantBudgetLine"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AllocationTarget" ADD CONSTRAINT "AllocationTarget_allocationRuleId_fkey" FOREIGN KEY ("allocationRuleId") REFERENCES "AllocationRule"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AllocationTarget" ADD CONSTRAINT "AllocationTarget_programId_fkey" FOREIGN KEY ("programId") REFERENCES "Program"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AllocationTarget" ADD CONSTRAINT "AllocationTarget_grantBudgetLineId_fkey" FOREIGN KEY ("grantBudgetLineId") REFERENCES "GrantBudgetLine"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AllocatedLine" ADD CONSTRAINT "AllocatedLine_computeRunId_fkey" FOREIGN KEY ("computeRunId") REFERENCES "ComputeRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AllocatedLine" ADD CONSTRAINT "AllocatedLine_sourceLineId_fkey" FOREIGN KEY ("sourceLineId") REFERENCES "TransactionLine"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AllocatedLine" ADD CONSTRAINT "AllocatedLine_allocationRuleId_fkey" FOREIGN KEY ("allocationRuleId") REFERENCES "AllocationRule"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AllocatedLine" ADD CONSTRAINT "AllocatedLine_crosswalkRuleId_fkey" FOREIGN KEY ("crosswalkRuleId") REFERENCES "CrosswalkRule"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AllocatedLine" ADD CONSTRAINT "AllocatedLine_programId_fkey" FOREIGN KEY ("programId") REFERENCES "Program"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AllocatedLine" ADD CONSTRAINT "AllocatedLine_grantId_fkey" FOREIGN KEY ("grantId") REFERENCES "Grant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AllocatedLine" ADD CONSTRAINT "AllocatedLine_grantBudgetLineId_fkey" FOREIGN KEY ("grantBudgetLineId") REFERENCES "GrantBudgetLine"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PeriodLock" ADD CONSTRAINT "PeriodLock_computeRunId_fkey" FOREIGN KEY ("computeRunId") REFERENCES "ComputeRun"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Narrative" ADD CONSTRAINT "Narrative_grantId_fkey" FOREIGN KEY ("grantId") REFERENCES "Grant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Narrative" ADD CONSTRAINT "Narrative_computeRunId_fkey" FOREIGN KEY ("computeRunId") REFERENCES "ComputeRun"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
