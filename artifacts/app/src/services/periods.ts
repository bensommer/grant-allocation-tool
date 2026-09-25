import { prisma } from '@/lib/db';
import { recordAudit } from '@/lib/audit';
import { findOverlappingLock, snapshotLockedPeriod } from '@/services/grant-periods';

export async function lockPeriod(orgId: string, name: string, from: Date, to: Date, note: string) {
  if (!name.trim() || from > to || Number.isNaN(from.getTime()) || Number.isNaN(to.getTime()))
    throw new Error('Enter a name and a valid date range.');
  const run = await prisma.computeRun.findFirst({
    where: { orgId, isCurrent: true, status: 'succeeded' },
  });
  if (!run || run.stale)
    throw new Error('Recompute a current, non-stale run before locking a period.');
  const lock = await prisma.$transaction(async (tx) => {
    // Locks are org-wide and feed beginning balances; two locks covering the same day would
    // count that day's releases twice.
    const overlap = await findOverlappingLock(tx, orgId, from, to);
    if (overlap)
      throw new Error(
        `Period overlaps the existing lock "${overlap.name}" (${overlap.periodFrom.toISOString().slice(0, 10)} → ${overlap.periodTo.toISOString().slice(0, 10)}).`,
      );
    const lock = await tx.periodLock.create({
      data: {
        orgId,
        name: name.trim(),
        periodFrom: from,
        periodTo: to,
        note: note.trim() || null,
        computeRunId: run.id,
      },
    });
    await recordAudit(tx, {
      orgId,
      entity: 'PeriodLock',
      entityId: lock.id,
      action: 'create',
      after: lock,
    });
    return lock;
  });
  // Freeze each grant's figures for the period (JPH-23); closed periods are never recomputed.
  await snapshotLockedPeriod(orgId, lock.id);
  return lock;
}

/**
 * Reopen a period the app locked. Computed snapshots go with the lock (the period is open
 * again and will be frozen anew when it is re-locked); a period that carries reported figures
 * (JPH-23) is a period of record and cannot be reopened.
 */
export async function deletePeriodLock(orgId: string, id: string) {
  await prisma.$transaction(async (tx) => {
    const lock = await tx.periodLock.findFirst({ where: { orgId, id } });
    if (!lock) throw new Error('Period lock not found.');
    const reported = await tx.grantPeriodSnapshot.count({
      where: { periodLockId: id, source: 'reported' },
    });
    if (reported > 0)
      throw new Error(
        'This period carries reported figures entered before the app existed; it cannot be reopened.',
      );
    await tx.grantPeriodSnapshot.deleteMany({ where: { periodLockId: id } });
    await tx.periodLock.delete({ where: { id } });
    await recordAudit(tx, {
      orgId,
      entity: 'PeriodLock',
      entityId: id,
      action: 'delete',
      before: lock,
    });
  });
}

export async function periodDrift(orgId: string, id: string) {
  const lock = await prisma.periodLock.findFirst({ where: { orgId, id } });
  if (!lock) return null;
  const current = await prisma.computeRun.findFirst({ where: { orgId, isCurrent: true } });
  const versions = await prisma.sourceRowVersion.findMany({
    where: {
      orgId,
      entity: 'transactions',
      importBatch: { orgId, startedAt: { gte: lock.lockedAt } },
    },
    include: { importBatch: { select: { counts: true } } },
    orderBy: { createdAt: 'desc' },
  });
  const affected = versions.filter((v) => {
    const payload = v.payload as { txnDate?: string };
    const date = payload.txnDate?.slice(0, 10);
    return (
      date &&
      date >= lock.periodFrom.toISOString().slice(0, 10) &&
      date <= lock.periodTo.toISOString().slice(0, 10)
    );
  });
  const batches = await prisma.importBatch.findMany({
    where: { orgId, status: 'succeeded', startedAt: { gte: lock.lockedAt } },
    select: { id: true, counts: true },
    orderBy: { startedAt: 'desc' },
  });
  const added = batches.flatMap((batch) => {
    const counts = batch.counts as { lockNewIds?: Record<string, string[]> };
    return (counts.lockNewIds?.[lock.id] ?? []).map((externalId) => ({
      externalId,
      importBatchId: batch.id,
    }));
  });
  const totals = async (runId: string) =>
    prisma.allocatedLine.findMany({
      where: {
        orgId,
        computeRunId: runId,
        sourceLine: {
          transaction: { txnDate: { gte: lock.periodFrom, lte: lock.periodTo } },
          account: { type: { in: ['Expense', 'COGS', 'OtherExpense'] } },
        },
      },
      select: {
        amountCents: true,
        program: { select: { code: true } },
        grant: { select: { name: true } },
        sourceLine: { select: { account: { select: { number: true } } } },
      },
    });
  const [before, after] = await Promise.all([
    lock.computeRunId ? totals(lock.computeRunId) : Promise.resolve([]),
    current ? totals(current.id) : Promise.resolve([]),
  ]);
  const aggregated = new Map<
    string,
    { grant: string; program: string; gl: string; before: number; after: number }
  >();
  for (const [rows, field] of [
    [before, 'before'],
    [after, 'after'],
  ] as const)
    for (const row of rows) {
      const grant = row.grant?.name ?? 'Unassigned';
      const program = row.program?.code ?? 'Unassigned';
      const gl = row.sourceLine.account.number ?? '—';
      const key = `${grant}|${program}|${gl}`;
      const cell = aggregated.get(key) ?? { grant, program, gl, before: 0, after: 0 };
      cell[field] += row.amountCents;
      aggregated.set(key, cell);
    }
  return {
    lock,
    current,
    affected,
    added,
    deltas: [...aggregated.values()].filter((row) => row.before !== row.after),
  };
}
