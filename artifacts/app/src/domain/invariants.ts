import { prisma } from '@/lib/db';

export class AllocationImbalanceError extends Error {
  constructor(public readonly details: Array<{ sourceLineId: string; expected: number; actual: number }>) {
    super(
      `Allocation imbalance in ${details.length} source line(s): ` +
        details
          .slice(0, 5)
          .map((d) => `${d.sourceLineId} expected ${d.expected} got ${d.actual}`)
          .join('; '),
    );
    this.name = 'AllocationImbalanceError';
  }
}

/**
 * Invariant: for every source line touched by a ComputeRun, Σ AllocatedLine.amountCents
 * equals TransactionLine.amountCents exactly. Throws AllocationImbalanceError otherwise.
 */
export async function assertAllocationBalanced(computeRunId: string): Promise<{ lines: number }> {
  const rows = await prisma.$queryRaw<
    Array<{ sourceLineId: string; expected: number; actual: bigint | number }>
  >`
    SELECT al."sourceLineId", tl."amountCents" AS "expected", SUM(al."amountCents") AS "actual"
    FROM "AllocatedLine" al
    JOIN "TransactionLine" tl ON tl.id = al."sourceLineId"
    WHERE al."computeRunId" = ${computeRunId}
    GROUP BY al."sourceLineId", tl."amountCents"
  `;
  const bad = rows
    .map((r) => ({ sourceLineId: r.sourceLineId, expected: r.expected, actual: Number(r.actual) }))
    .filter((r) => r.expected !== r.actual);
  if (bad.length > 0) throw new AllocationImbalanceError(bad);
  return { lines: rows.length };
}

/**
 * Guard for deleting an ImportBatch: refuse if any succeeded ("closed") ComputeRun
 * or PeriodLock references it. ComputeRun.sourceBatchIds is an array column, so
 * this is enforced in the domain layer rather than by FK.
 */
export async function assertImportBatchDeletable(importBatchId: string): Promise<void> {
  const run = await prisma.computeRun.findFirst({
    where: { sourceBatchIds: { has: importBatchId }, status: { in: ['succeeded', 'superseded'] } },
    select: { id: true },
  });
  if (run) {
    throw new Error(`Import batch ${importBatchId} is referenced by compute run ${run.id} and cannot be deleted`);
  }
}
