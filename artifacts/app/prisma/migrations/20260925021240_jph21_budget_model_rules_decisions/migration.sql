-- CreateEnum
CREATE TYPE "BudgetLineKind" AS ENUM ('funder_category', 'working_line', 'cell');

-- CreateEnum
CREATE TYPE "DecisionKind" AS ENUM ('assign', 'exclude', 'at_risk', 'reversal_pair');

-- CreateEnum
CREATE TYPE "GrantLineState" AS ENUM ('assigned', 'excluded', 'needs_review');

-- CreateEnum
CREATE TYPE "RuleDimension" AS ENUM ('line', 'activity', 'category');

-- AlterTable
ALTER TABLE "CrosswalkRule" ADD COLUMN     "dimension" "RuleDimension" NOT NULL DEFAULT 'line',
ADD COLUMN     "grantId" TEXT,
ADD COLUMN     "targetActivityId" TEXT,
ADD COLUMN     "targetCategoryKey" TEXT,
ALTER COLUMN "grantBudgetLineId" DROP NOT NULL;

-- AlterTable
ALTER TABLE "GrantBudgetLine" ADD COLUMN     "activityId" TEXT,
ADD COLUMN     "categoryKey" TEXT,
ADD COLUMN     "kind" "BudgetLineKind" NOT NULL DEFAULT 'working_line',
ADD COLUMN     "parentId" TEXT;

-- CreateTable
CREATE TABLE "GrantActivity" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "grantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "aliases" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "plannedCount" INTEGER NOT NULL DEFAULT 0,
    "completedCount" INTEGER NOT NULL DEFAULT 0,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "GrantActivity_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BudgetRevision" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "grantId" TEXT NOT NULL,
    "budgetLineId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "deltaCents" INTEGER NOT NULL,
    "counterpartLineId" TEXT,
    "note" TEXT NOT NULL,
    "actor" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BudgetRevision_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LineDecision" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "grantId" TEXT NOT NULL,
    "groupId" TEXT NOT NULL,
    "fingerprint" TEXT NOT NULL,
    "transactionLineId" TEXT,
    "kind" "DecisionKind" NOT NULL,
    "targetBudgetLineId" TEXT,
    "reason" TEXT,
    "note" TEXT NOT NULL,
    "actor" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "supersededAt" TIMESTAMP(3),

    CONSTRAINT "LineDecision_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GrantLineResult" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "computeRunId" TEXT NOT NULL,
    "grantId" TEXT NOT NULL,
    "transactionLineId" TEXT NOT NULL,
    "state" "GrantLineState" NOT NULL,
    "budgetLineId" TEXT,
    "activityId" TEXT,
    "ruleId" TEXT,
    "categoryRuleId" TEXT,
    "decisionId" TEXT,
    "reason" TEXT,
    "atRisk" BOOLEAN NOT NULL DEFAULT false,
    "amountCents" INTEGER NOT NULL,

    CONSTRAINT "GrantLineResult_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "GrantActivity_orgId_grantId_idx" ON "GrantActivity"("orgId", "grantId");

-- CreateIndex
CREATE INDEX "BudgetRevision_grantId_budgetLineId_idx" ON "BudgetRevision"("grantId", "budgetLineId");

-- CreateIndex
CREATE INDEX "LineDecision_orgId_grantId_supersededAt_idx" ON "LineDecision"("orgId", "grantId", "supersededAt");

-- CreateIndex
CREATE INDEX "LineDecision_grantId_fingerprint_idx" ON "LineDecision"("grantId", "fingerprint");

-- CreateIndex
CREATE INDEX "LineDecision_groupId_idx" ON "LineDecision"("groupId");

-- CreateIndex
CREATE INDEX "GrantLineResult_computeRunId_grantId_state_idx" ON "GrantLineResult"("computeRunId", "grantId", "state");

-- CreateIndex
CREATE INDEX "GrantLineResult_computeRunId_grantId_transactionLineId_idx" ON "GrantLineResult"("computeRunId", "grantId", "transactionLineId");

-- CreateIndex
CREATE INDEX "GrantLineResult_computeRunId_budgetLineId_idx" ON "GrantLineResult"("computeRunId", "budgetLineId");

-- CreateIndex
CREATE INDEX "CrosswalkRule_grantId_dimension_priority_idx" ON "CrosswalkRule"("grantId", "dimension", "priority");

-- CreateIndex
CREATE INDEX "GrantBudgetLine_grantId_activityId_categoryKey_idx" ON "GrantBudgetLine"("grantId", "activityId", "categoryKey");

-- AddForeignKey
ALTER TABLE "GrantBudgetLine" ADD CONSTRAINT "GrantBudgetLine_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "GrantBudgetLine"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GrantBudgetLine" ADD CONSTRAINT "GrantBudgetLine_activityId_fkey" FOREIGN KEY ("activityId") REFERENCES "GrantActivity"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GrantActivity" ADD CONSTRAINT "GrantActivity_grantId_fkey" FOREIGN KEY ("grantId") REFERENCES "Grant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BudgetRevision" ADD CONSTRAINT "BudgetRevision_grantId_fkey" FOREIGN KEY ("grantId") REFERENCES "Grant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BudgetRevision" ADD CONSTRAINT "BudgetRevision_budgetLineId_fkey" FOREIGN KEY ("budgetLineId") REFERENCES "GrantBudgetLine"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BudgetRevision" ADD CONSTRAINT "BudgetRevision_counterpartLineId_fkey" FOREIGN KEY ("counterpartLineId") REFERENCES "GrantBudgetLine"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LineDecision" ADD CONSTRAINT "LineDecision_grantId_fkey" FOREIGN KEY ("grantId") REFERENCES "Grant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LineDecision" ADD CONSTRAINT "LineDecision_transactionLineId_fkey" FOREIGN KEY ("transactionLineId") REFERENCES "TransactionLine"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LineDecision" ADD CONSTRAINT "LineDecision_targetBudgetLineId_fkey" FOREIGN KEY ("targetBudgetLineId") REFERENCES "GrantBudgetLine"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GrantLineResult" ADD CONSTRAINT "GrantLineResult_computeRunId_fkey" FOREIGN KEY ("computeRunId") REFERENCES "ComputeRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GrantLineResult" ADD CONSTRAINT "GrantLineResult_grantId_fkey" FOREIGN KEY ("grantId") REFERENCES "Grant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GrantLineResult" ADD CONSTRAINT "GrantLineResult_transactionLineId_fkey" FOREIGN KEY ("transactionLineId") REFERENCES "TransactionLine"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GrantLineResult" ADD CONSTRAINT "GrantLineResult_budgetLineId_fkey" FOREIGN KEY ("budgetLineId") REFERENCES "GrantBudgetLine"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GrantLineResult" ADD CONSTRAINT "GrantLineResult_activityId_fkey" FOREIGN KEY ("activityId") REFERENCES "GrantActivity"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CrosswalkRule" ADD CONSTRAINT "CrosswalkRule_grantId_fkey" FOREIGN KEY ("grantId") REFERENCES "Grant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CrosswalkRule" ADD CONSTRAINT "CrosswalkRule_targetActivityId_fkey" FOREIGN KEY ("targetActivityId") REFERENCES "GrantActivity"("id") ON DELETE SET NULL ON UPDATE CASCADE;
