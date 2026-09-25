-- AlterTable
ALTER TABLE "CorrectingEntryLine" ADD COLUMN     "className" TEXT,
ADD COLUMN     "partyName" TEXT;

-- AlterTable
ALTER TABLE "Grant" ADD COLUMN     "qboClassName" TEXT,
ADD COLUMN     "qboProjectName" TEXT;
