-- CreateEnum
CREATE TYPE "ReleaseClass" AS ENUM ('direct', 'staff', 'overhead');

-- CreateEnum
CREATE TYPE "SnapshotSource" AS ENUM ('computed', 'reported');

-- AlterTable
ALTER TABLE "GrantBudgetLine" ADD COLUMN     "releaseClass" "ReleaseClass" NOT NULL DEFAULT 'direct';

-- AlterTable
ALTER TABLE "PeriodLock" ALTER COLUMN "computeRunId" DROP NOT NULL;

-- CreateTable
CREATE TABLE "GrantPeriodSnapshot" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "periodLockId" TEXT NOT NULL,
    "grantId" TEXT NOT NULL,
    "releaseClass" "ReleaseClass",
    "releasedCents" INTEGER NOT NULL DEFAULT 0,
    "receivedCents" INTEGER NOT NULL DEFAULT 0,
    "source" "SnapshotSource" NOT NULL,
    "note" TEXT,
    "actor" TEXT NOT NULL DEFAULT 'local-user',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "supersededAt" TIMESTAMP(3),

    CONSTRAINT "GrantPeriodSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "GrantPeriodSnapshot_grantId_periodLockId_idx" ON "GrantPeriodSnapshot"("grantId", "periodLockId");

-- CreateIndex
CREATE INDEX "GrantPeriodSnapshot_orgId_periodLockId_idx" ON "GrantPeriodSnapshot"("orgId", "periodLockId");

-- AddForeignKey
ALTER TABLE "GrantPeriodSnapshot" ADD CONSTRAINT "GrantPeriodSnapshot_periodLockId_fkey" FOREIGN KEY ("periodLockId") REFERENCES "PeriodLock"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GrantPeriodSnapshot" ADD CONSTRAINT "GrantPeriodSnapshot_grantId_fkey" FOREIGN KEY ("grantId") REFERENCES "Grant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
