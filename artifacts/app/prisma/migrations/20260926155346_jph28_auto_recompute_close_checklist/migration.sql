-- CreateEnum
CREATE TYPE "RunTrigger" AS ENUM ('manual', 'auto', 'import');

-- AlterTable
ALTER TABLE "ComputeRun" ADD COLUMN     "cause" TEXT,
ADD COLUMN     "trigger" "RunTrigger" NOT NULL DEFAULT 'manual';

-- CreateTable
CREATE TABLE "RecomputeLock" (
    "orgId" TEXT NOT NULL,
    "running" BOOLEAN NOT NULL DEFAULT false,
    "pending" BOOLEAN NOT NULL DEFAULT false,
    "pendingCause" TEXT,
    "lockedAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RecomputeLock_pkey" PRIMARY KEY ("orgId")
);

-- CreateTable
CREATE TABLE "Export" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "periodFrom" DATE NOT NULL,
    "periodTo" DATE NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actor" TEXT,

    CONSTRAINT "Export_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Export_orgId_kind_periodTo_idx" ON "Export"("orgId", "kind", "periodTo");
