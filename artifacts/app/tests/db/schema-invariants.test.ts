import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '@/lib/db';
import { recordAudit } from '@/lib/audit';
import { assertAllocationBalanced, AllocationImbalanceError } from '@/domain/invariants';
import { splitLargestRemainder } from '@/domain/split';
import { createTestOrg, resetDatabase } from './helpers';

describe('schema invariants (JPH-5)', () => {
  let orgId: string;

  beforeEach(async () => {
    await resetDatabase();
    orgId = await createTestOrg();
  });
  afterAll(async () => {
    await prisma.$disconnect();
  });

  async function seedSourceLine(amountCents: number) {
    const batch = await prisma.importBatch.create({
      data: { orgId, sourceSystem: 'csv', status: 'succeeded' },
    });
    const account = await prisma.account.create({
      data: {
        orgId,
        sourceSystem: 'csv',
        externalId: 'acct-utilities',
        importBatchId: batch.id,
        number: '6300',
        name: 'Utilities',
        type: 'Expense',
      },
    });
    const txn = await prisma.transaction.create({
      data: {
        orgId,
        sourceSystem: 'csv',
        externalId: 'txn-1',
        importBatchId: batch.id,
        txnType: 'Bill',
        txnDate: new Date('2026-03-15T00:00:00Z'),
        totalCents: amountCents,
      },
    });
    const line = await prisma.transactionLine.create({
      data: {
        orgId,
        transactionId: txn.id,
        lineNumber: 1,
        accountId: account.id,
        amountCents,
        postingType: 'debit',
      },
    });
    return { batch, account, txn, line };
  }

  it('1000 cents allocated 3333/3333/3334 bps sums to exactly 1000 and passes the invariant', async () => {
    const { line, batch } = await seedSourceLine(1000);
    const programs = await Promise.all(
      ['A', 'B', 'C'].map((code) => prisma.program.create({ data: { orgId, code, name: `Program ${code}` } })),
    );
    const run = await prisma.computeRun.create({
      data: { orgId, configHash: 'x', sourceBatchIds: [batch.id], status: 'succeeded' },
    });
    const parts = splitLargestRemainder(1000, [3333, 3333, 3334]);
    expect(parts).toEqual([333, 333, 334]);
    await prisma.allocatedLine.createMany({
      data: parts.map((amountCents, i) => ({
        orgId,
        computeRunId: run.id,
        sourceLineId: line.id,
        pieceIndex: i,
        programId: programs[i]!.id,
        amountCents,
      })),
    });
    await expect(assertAllocationBalanced(run.id)).resolves.toEqual({ lines: 1 });

    // Break it and confirm the checker fails.
    await prisma.allocatedLine.updateMany({
      where: { computeRunId: run.id, pieceIndex: 2 },
      data: { amountCents: 335 },
    });
    await expect(assertAllocationBalanced(run.id)).rejects.toBeInstanceOf(AllocationImbalanceError);
  });

  it('unique (orgId, sourceSystem, externalId) rejects duplicates', async () => {
    const { batch } = await seedSourceLine(100);
    await expect(
      prisma.account.create({
        data: {
          orgId,
          sourceSystem: 'csv',
          externalId: 'acct-utilities',
          importBatchId: batch.id,
          name: 'Dup',
          type: 'Expense',
        },
      }),
    ).rejects.toThrow(/Unique constraint/);
  });

  it('deleting a source account referenced by an allocated line is blocked (no cascade from overlay)', async () => {
    const { line, account, batch } = await seedSourceLine(500);
    const run = await prisma.computeRun.create({
      data: { orgId, configHash: 'x', sourceBatchIds: [batch.id], status: 'succeeded' },
    });
    await prisma.allocatedLine.create({
      data: { orgId, computeRunId: run.id, sourceLineId: line.id, pieceIndex: 0, amountCents: 500 },
    });
    // Deleting the run cascades only to AllocatedLine, never to source rows.
    await prisma.computeRun.delete({ where: { id: run.id } });
    expect(await prisma.transactionLine.count()).toBe(1);
    expect(await prisma.account.count({ where: { id: account.id } })).toBe(1);
    // Deleting the import batch is blocked while source rows reference it.
    await expect(prisma.importBatch.delete({ where: { id: batch.id } })).rejects.toThrow(
      /Foreign key constraint/,
    );
  });

  it('AuditEvent records before/after for a Grant update', async () => {
    const grant = await prisma.grant.create({
      data: {
        orgId,
        name: 'Test Grant',
        funder: 'Funder',
        startDate: new Date('2026-01-01T00:00:00Z'),
        endDate: new Date('2026-12-31T00:00:00Z'),
        awardAmountCents: 1_000_000,
      },
    });
    const updated = await prisma.$transaction(async (tx) => {
      const after = await tx.grant.update({ where: { id: grant.id }, data: { awardAmountCents: 1_200_000 } });
      await recordAudit(tx, {
        orgId,
        entity: 'Grant',
        entityId: grant.id,
        action: 'update',
        before: grant,
        after,
      });
      return after;
    });
    const events = await prisma.auditEvent.findMany({ where: { entityId: grant.id } });
    expect(events).toHaveLength(1);
    const ev = events[0]!;
    expect(ev.action).toBe('update');
    expect((ev.before as { awardAmountCents: number }).awardAmountCents).toBe(1_000_000);
    expect((ev.after as { awardAmountCents: number }).awardAmountCents).toBe(1_200_000);
    expect(updated.awardAmountCents).toBe(1_200_000);
  });
});
