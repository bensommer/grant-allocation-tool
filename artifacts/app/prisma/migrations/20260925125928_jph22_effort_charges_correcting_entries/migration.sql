-- CreateEnum
CREATE TYPE "GrantLineSource" AS ENUM ('transaction', 'effort');

-- CreateEnum
CREATE TYPE "CorrectingEntryKind" AS ENUM ('reclass', 'true_up');

-- CreateEnum
CREATE TYPE "CorrectingEntryStatus" AS ENUM ('drafted', 'posted', 'void');

-- AlterTable
ALTER TABLE "GrantLineResult" ADD COLUMN     "effortEntryId" TEXT,
ADD COLUMN     "effortScheduleId" TEXT,
ADD COLUMN     "source" "GrantLineSource" NOT NULL DEFAULT 'transaction',
ALTER COLUMN "transactionLineId" DROP NOT NULL;

-- CreateTable
CREATE TABLE "EffortSchedule" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "grantId" TEXT NOT NULL,
    "personLabel" TEXT NOT NULL,
    "personPartyId" TEXT,
    "salaryCents" INTEGER,
    "hourlyRate" DECIMAL(12,4),
    "burdenBps" INTEGER NOT NULL DEFAULT 0,
    "targetCategoryKey" TEXT NOT NULL,
    "actualPayrollMatchers" JSONB NOT NULL DEFAULT '{}',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "carriedVarianceCents" INTEGER,
    "carriedVarianceNote" TEXT,
    "carriedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EffortSchedule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EffortEntry" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "scheduleId" TEXT NOT NULL,
    "activityId" TEXT NOT NULL,
    "hoursPerOccurrence" DECIMAL(8,2) NOT NULL,
    "completedCountOverride" INTEGER,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "EffortEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CorrectingEntryDraft" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "grantId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "kind" "CorrectingEntryKind" NOT NULL,
    "status" "CorrectingEntryStatus" NOT NULL DEFAULT 'drafted',
    "sourceDecisionGroupId" TEXT,
    "sourceScheduleId" TEXT,
    "postedTransactionId" TEXT,
    "date" DATE NOT NULL,
    "memo" TEXT NOT NULL,
    "actor" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "postedAt" TIMESTAMP(3),
    "voidedAt" TIMESTAMP(3),
    "voidNote" TEXT,

    CONSTRAINT "CorrectingEntryDraft_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CorrectingEntryLine" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "draftId" TEXT NOT NULL,
    "lineNumber" INTEGER NOT NULL,
    "accountId" TEXT NOT NULL,
    "classId" TEXT,
    "partyId" TEXT,
    "grantSide" BOOLEAN NOT NULL DEFAULT false,
    "debitCents" INTEGER NOT NULL DEFAULT 0,
    "creditCents" INTEGER NOT NULL DEFAULT 0,
    "description" TEXT NOT NULL,

    CONSTRAINT "CorrectingEntryLine_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "EffortSchedule_orgId_grantId_active_idx" ON "EffortSchedule"("orgId", "grantId", "active");

-- CreateIndex
CREATE UNIQUE INDEX "EffortEntry_scheduleId_activityId_key" ON "EffortEntry"("scheduleId", "activityId");

-- CreateIndex
CREATE INDEX "CorrectingEntryDraft_orgId_grantId_status_idx" ON "CorrectingEntryDraft"("orgId", "grantId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "CorrectingEntryDraft_orgId_code_key" ON "CorrectingEntryDraft"("orgId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "CorrectingEntryLine_draftId_lineNumber_key" ON "CorrectingEntryLine"("draftId", "lineNumber");

-- CreateIndex
CREATE INDEX "GrantLineResult_computeRunId_effortScheduleId_idx" ON "GrantLineResult"("computeRunId", "effortScheduleId");

-- AddForeignKey
ALTER TABLE "GrantLineResult" ADD CONSTRAINT "GrantLineResult_effortEntryId_fkey" FOREIGN KEY ("effortEntryId") REFERENCES "EffortEntry"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EffortSchedule" ADD CONSTRAINT "EffortSchedule_grantId_fkey" FOREIGN KEY ("grantId") REFERENCES "Grant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EffortEntry" ADD CONSTRAINT "EffortEntry_scheduleId_fkey" FOREIGN KEY ("scheduleId") REFERENCES "EffortSchedule"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EffortEntry" ADD CONSTRAINT "EffortEntry_activityId_fkey" FOREIGN KEY ("activityId") REFERENCES "GrantActivity"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CorrectingEntryDraft" ADD CONSTRAINT "CorrectingEntryDraft_grantId_fkey" FOREIGN KEY ("grantId") REFERENCES "Grant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CorrectingEntryDraft" ADD CONSTRAINT "CorrectingEntryDraft_sourceScheduleId_fkey" FOREIGN KEY ("sourceScheduleId") REFERENCES "EffortSchedule"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CorrectingEntryLine" ADD CONSTRAINT "CorrectingEntryLine_draftId_fkey" FOREIGN KEY ("draftId") REFERENCES "CorrectingEntryDraft"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CorrectingEntryLine" ADD CONSTRAINT "CorrectingEntryLine_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
