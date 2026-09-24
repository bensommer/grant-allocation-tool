import { prisma } from '@/lib/db';

/** Organization-scoped coverage and most recent promoted compute run. */
export async function getGlobalStatus(orgId: string) {
  const [lastTransaction, currentRun] = await Promise.all([
    prisma.transaction.findFirst({
      where: { orgId, deletedAt: null },
      orderBy: { txnDate: 'desc' },
      select: { txnDate: true },
    }),
    prisma.computeRun.findFirst({
      where: { orgId, isCurrent: true },
      orderBy: { startedAt: 'desc' },
      select: { finishedAt: true, startedAt: true, stale: true },
    }),
  ]);
  return { booksThrough: lastTransaction?.txnDate ?? null, currentRun };
}
