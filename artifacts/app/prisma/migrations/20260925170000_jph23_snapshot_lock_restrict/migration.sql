-- JPH-23: a period lock that carries grant snapshots cannot be dropped out from under them.
-- Reopening a period goes through the service, which removes computed snapshots first and
-- refuses when reported (period-of-record) snapshots exist.
ALTER TABLE "GrantPeriodSnapshot" DROP CONSTRAINT "GrantPeriodSnapshot_periodLockId_fkey";
ALTER TABLE "GrantPeriodSnapshot" ADD CONSTRAINT "GrantPeriodSnapshot_periodLockId_fkey" FOREIGN KEY ("periodLockId") REFERENCES "PeriodLock"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
