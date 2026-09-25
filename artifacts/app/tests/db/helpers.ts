import { prisma } from '@/lib/db';
import { resetOrgCache } from '@/lib/org';

/** Wipe all data (tests only). Order respects FKs. */
export async function resetDatabase(): Promise<void> {
  await prisma.$executeRawUnsafe(`
    TRUNCATE TABLE
      "Narrative","PeriodLock","GrantLineResult","LineDecision","BudgetRevision","GrantActivity","GrantMembership","QboReportUpload","AllocatedLine","ComputeRun","AllocationDriverValue",
      "AllocationTarget","AllocationRule","CrosswalkRule","GrantBudgetLine","GrantProgram",
      "Grant","Program","AuditEvent","SavedView","SourceRowVersion","TransactionLine",
      "Transaction","Party","TrackingLocation","TrackingClass","Account","ImportBatch","Org"
    RESTART IDENTITY CASCADE
  `);
  resetOrgCache();
}

export async function createTestOrg(name = 'Test Org'): Promise<string> {
  const org = await prisma.org.create({ data: { name } });
  return org.id;
}
