-- CreateEnum
CREATE TYPE "GrantMembershipVia" AS ENUM ('import_scope', 'class_match', 'project_match');

-- AlterEnum
ALTER TYPE "SourceSystem" ADD VALUE 'qbo_report';

-- AlterTable
ALTER TABLE "Grant" ADD COLUMN     "memberClassIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "memberPartyIds" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- AlterTable
ALTER TABLE "ImportBatch" ADD COLUMN     "checksums" JSONB NOT NULL DEFAULT '[]',
ADD COLUMN     "reportMeta" JSONB NOT NULL DEFAULT '{}',
ADD COLUMN     "scopeDateFrom" DATE,
ADD COLUMN     "scopeDateTo" DATE,
ADD COLUMN     "scopeGrantId" TEXT;

-- CreateTable
CREATE TABLE "GrantMembership" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "grantId" TEXT NOT NULL,
    "transactionLineId" TEXT NOT NULL,
    "via" "GrantMembershipVia" NOT NULL,
    "importBatchId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "supersededAt" TIMESTAMP(3),

    CONSTRAINT "GrantMembership_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "QboReportUpload" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "grantId" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "sheetName" TEXT,
    "sha256" TEXT NOT NULL,
    "content" BYTEA NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "consumedAt" TIMESTAMP(3),
    "batchId" TEXT,

    CONSTRAINT "QboReportUpload_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "GrantMembership_orgId_grantId_supersededAt_idx" ON "GrantMembership"("orgId", "grantId", "supersededAt");

-- CreateIndex
CREATE INDEX "GrantMembership_transactionLineId_idx" ON "GrantMembership"("transactionLineId");

-- CreateIndex
CREATE INDEX "QboReportUpload_orgId_createdAt_idx" ON "QboReportUpload"("orgId", "createdAt");

-- AddForeignKey
ALTER TABLE "ImportBatch" ADD CONSTRAINT "ImportBatch_scopeGrantId_fkey" FOREIGN KEY ("scopeGrantId") REFERENCES "Grant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GrantMembership" ADD CONSTRAINT "GrantMembership_grantId_fkey" FOREIGN KEY ("grantId") REFERENCES "Grant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GrantMembership" ADD CONSTRAINT "GrantMembership_transactionLineId_fkey" FOREIGN KEY ("transactionLineId") REFERENCES "TransactionLine"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GrantMembership" ADD CONSTRAINT "GrantMembership_importBatchId_fkey" FOREIGN KEY ("importBatchId") REFERENCES "ImportBatch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QboReportUpload" ADD CONSTRAINT "QboReportUpload_grantId_fkey" FOREIGN KEY ("grantId") REFERENCES "Grant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
