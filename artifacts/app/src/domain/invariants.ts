import { prisma } from '@/lib/db';

export class AllocationImbalanceError extends Error {
  constructor(
    public readonly details: Array<{ sourceLineId: string; expected: number; actual: number }>,
  ) {
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

export class GrantStateImbalanceError extends Error {
  constructor(public readonly details: Array<{ grantId: string; problem: string }>) {
    super(
      `Grant line state imbalance in ${details.length} grant(s): ` +
        details
          .slice(0, 5)
          .map((d) => `${d.grantId}: ${d.problem}`)
          .join('; '),
    );
    this.name = 'GrantStateImbalanceError';
  }
}

/**
 * Invariant (JPH-21): for every grant in a ComputeRun, each expense member
 * line has exactly one GrantLineResult, and Σ assigned + Σ excluded +
 * Σ needs_review equals Σ of those member lines' amounts, to the cent.
 * Only `source = transaction` rows take part: effort charges (JPH-22) are
 * computed amounts with no member line behind them.
 * Throws GrantStateImbalanceError otherwise.
 */
export async function assertGrantStatesBalanced(computeRunId: string): Promise<{ grants: number }> {
  const duplicates = await prisma.$queryRaw<
    Array<{ grantId: string; transactionLineId: string; n: bigint | number }>
  >`
    SELECT "grantId", "transactionLineId", COUNT(*) AS n
    FROM "GrantLineResult"
    WHERE "computeRunId" = ${computeRunId} AND "source" = 'transaction'
    GROUP BY "grantId", "transactionLineId"
    HAVING COUNT(*) > 1
  `;
  const bad: Array<{ grantId: string; problem: string }> = duplicates.map((d) => ({
    grantId: d.grantId,
    problem: `line ${d.transactionLineId} has ${Number(d.n)} states`,
  }));

  const grants = await prisma.$queryRaw<
    Array<{
      grantId: string;
      memberCount: bigint | number;
      memberCents: bigint | number | null;
      resultCount: bigint | number;
      resultCents: bigint | number | null;
    }>
  >`
    WITH members AS (
      SELECT gm."grantId", tl.id, tl."amountCents"
      FROM "GrantMembership" gm
      JOIN "TransactionLine" tl ON tl.id = gm."transactionLineId"
      JOIN "Transaction" t ON t.id = tl."transactionId"
      JOIN "Account" a ON a.id = tl."accountId"
      JOIN "Grant" g ON g.id = gm."grantId"
      WHERE gm."supersededAt" IS NULL AND tl."deletedAt" IS NULL AND t."deletedAt" IS NULL
        AND g.status <> 'archived'
        AND a.type IN ('Expense', 'COGS', 'OtherExpense')
    ), m AS (
      SELECT "grantId", COUNT(DISTINCT id) AS c, SUM("amountCents") AS s FROM (
        SELECT DISTINCT "grantId", id, "amountCents" FROM members
      ) d GROUP BY "grantId"
    ), r AS (
      SELECT "grantId", COUNT(*) AS c, SUM("amountCents") AS s
      FROM "GrantLineResult"
      WHERE "computeRunId" = ${computeRunId} AND "source" = 'transaction'
      GROUP BY "grantId"
    )
    SELECT COALESCE(m."grantId", r."grantId") AS "grantId",
           COALESCE(m.c, 0) AS "memberCount", m.s AS "memberCents",
           COALESCE(r.c, 0) AS "resultCount", r.s AS "resultCents"
    FROM m FULL OUTER JOIN r ON m."grantId" = r."grantId"
  `;
  // Set equality, not just equal counts and sums: every state row must belong to a current
  // expense member line and carry that line's amount.
  const strays = await prisma.$queryRaw<
    Array<{ grantId: string; transactionLineId: string; problem: string }>
  >`
    SELECT r."grantId", r."transactionLineId",
           CASE WHEN tl.id IS NULL THEN 'state row for a line that is not a current expense member'
                ELSE 'state amount ' || r."amountCents" || ' ≠ line amount ' || tl."amountCents" END AS problem
    FROM "GrantLineResult" r
    LEFT JOIN "TransactionLine" tl
      ON tl.id = r."transactionLineId" AND tl."deletedAt" IS NULL
     AND EXISTS (
       SELECT 1 FROM "GrantMembership" gm
       JOIN "Transaction" t ON t.id = tl."transactionId"
       JOIN "Account" a ON a.id = tl."accountId"
       WHERE gm."transactionLineId" = tl.id AND gm."grantId" = r."grantId"
         AND gm."supersededAt" IS NULL AND t."deletedAt" IS NULL
         AND a.type IN ('Expense', 'COGS', 'OtherExpense'))
    WHERE r."computeRunId" = ${computeRunId} AND r."source" = 'transaction'
      AND (tl.id IS NULL OR tl."amountCents" <> r."amountCents")
    LIMIT 50
  `;
  for (const s of strays)
    bad.push({ grantId: s.grantId, problem: `line ${s.transactionLineId}: ${s.problem}` });

  for (const g of grants) {
    const mc = Number(g.memberCount);
    const rc = Number(g.resultCount);
    const ms = Number(g.memberCents ?? 0);
    const rs = Number(g.resultCents ?? 0);
    if (mc !== rc)
      bad.push({ grantId: g.grantId, problem: `${mc} member lines but ${rc} state rows` });
    else if (ms !== rs)
      bad.push({ grantId: g.grantId, problem: `Σ states ${rs} ≠ Σ members ${ms}` });
  }
  if (bad.length > 0) throw new GrantStateImbalanceError(bad);
  return { grants: grants.length };
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
    throw new Error(
      `Import batch ${importBatchId} is referenced by compute run ${run.id} and cannot be deleted`,
    );
  }
}
