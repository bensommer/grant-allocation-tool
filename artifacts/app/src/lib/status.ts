import { prisma } from '@/lib/db';

export type FreshnessState = 'fresh' | 'updating' | 'failed' | 'needs_update' | 'none';

/** Organization-scoped coverage and most recent promoted calculation (header chip, JPH-28 D3). */
export async function getGlobalStatus(orgId: string, now = new Date()) {
  const [lastTransaction, currentRun, lock] = await Promise.all([
    prisma.transaction.findFirst({
      where: { orgId, deletedAt: null },
      orderBy: { txnDate: 'desc' },
      select: { txnDate: true },
    }),
    prisma.computeRun.findFirst({
      where: { orgId, isCurrent: true },
      orderBy: { startedAt: 'desc' },
      select: { id: true, finishedAt: true, startedAt: true, stale: true },
    }),
    prisma.recomputeLock.findUnique({ where: { orgId }, select: { running: true } }),
  ]);
  // A failed calculation newer than the current one means the last change did not land.
  const failedRun = await prisma.computeRun.findFirst({
    where: {
      orgId,
      status: 'failed',
      ...(currentRun ? { startedAt: { gt: currentRun.startedAt } } : {}),
    },
    orderBy: { startedAt: 'desc' },
    select: { id: true, finishedAt: true },
  });
  const updatedAt = currentRun ? (currentRun.finishedAt ?? currentRun.startedAt) : null;
  const state: FreshnessState = lock?.running
    ? 'updating'
    : failedRun
      ? 'failed'
      : !currentRun
        ? 'none'
        : currentRun.stale
          ? 'needs_update'
          : 'fresh';
  return {
    booksThrough: lastTransaction?.txnDate ?? null,
    currentRun,
    failedRun,
    state,
    updatedAt,
    ageMs: updatedAt ? Math.max(0, now.getTime() - updatedAt.getTime()) : null,
  };
}
