-- AlterTable
ALTER TABLE "Transaction" ADD COLUMN     "matchKey" TEXT;

-- CreateIndex
CREATE INDEX "Transaction_orgId_sourceSystem_matchKey_idx" ON "Transaction"("orgId", "sourceSystem", "matchKey");
