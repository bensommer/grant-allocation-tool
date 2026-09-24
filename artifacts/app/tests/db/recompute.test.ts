import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '@/lib/db';
import { CsvDataSource } from '@/datasource/csv/adapter';
import { FULL_RANGE, runImport } from '@/datasource/import-service';
import { seedDemoOverlay } from '@/seed/demo-overlay';
import { allocate } from '@/engine/core';
import { recompute } from '@/engine/recompute';
import { createTestOrg, resetDatabase } from './helpers';

const DEMO = path.resolve(__dirname, '../../fixtures/demo');

async function ctRentQ1(runId: string) {
  const r = await prisma.allocatedLine.aggregate({
    _sum: { amountCents: true },
    where: {
      computeRunId: runId,
      program: { code: 'CT' },
      sourceLine: {
        account: { number: '6210' },
        transaction: { txnDate: { lte: new Date('2026-03-31') } },
      },
    },
  });
  return r._sum.amountCents ?? 0;
}

describe('recompute pipeline (JPH-10)', () => {
  let orgId: string;
  beforeAll(async () => {
    await resetDatabase();
    orgId = await createTestOrg();
    await runImport(orgId, new CsvDataSource({ dir: DEMO }), FULL_RANGE);
    await seedDemoOverlay(orgId, path.join(DEMO, 'overlay'));
  });
  afterAll(() => prisma.$disconnect());

  it('recomputes demo data in under 2 seconds and promotes the run', async () => {
    const r = await recompute(orgId);
    expect(r.status).toBe('succeeded');
    expect(r.durationMs).toBeLessThan(2000);
    const run = await prisma.computeRun.findUniqueOrThrow({ where: { id: r.runId } });
    expect(run.isCurrent).toBe(true);
    expect(run.stale).toBe(false);
    expect(run.configHash).toHaveLength(16);
    expect(run.sourceBatchIds).toHaveLength(1);
  });

  it('changing AR-OCC to 60/10/30 moves CT rent Q1 from 4,500.00 to 5,400.00 and supersedes the previous run', async () => {
    const before = await prisma.computeRun.findFirstOrThrow({ where: { orgId, isCurrent: true } });
    expect(await ctRentQ1(before.id)).toBe(450000);
    const rule = await prisma.allocationRule.findFirstOrThrow({
      where: { orgId, name: 'Occupancy by square footage' },
      include: { targets: { orderBy: { sortOrder: 'asc' } } },
    });
    const shares = [6000, 1000, 3000];
    for (const [i, t] of rule.targets.entries())
      await prisma.allocationTarget.update({ where: { id: t.id }, data: { shareBps: shares[i]! } });
    const r = await recompute(orgId);
    expect(r.status).toBe('succeeded');
    expect(await ctRentQ1(r.runId)).toBe(540000);
    const prev = await prisma.computeRun.findUniqueOrThrow({ where: { id: before.id } });
    expect(prev.status).toBe('superseded');
    expect(prev.isCurrent).toBe(false);
    expect(
      (await prisma.computeRun.findUniqueOrThrow({ where: { id: r.runId } })).configHash,
    ).not.toBe(before.configHash);
    // previous run's lines are retained for diffs
    expect(
      await prisma.allocatedLine.count({ where: { computeRunId: before.id } }),
    ).toBeGreaterThan(0);
  });

  it('an invariant violation marks the run failed and leaves the previous run current', async () => {
    const current = await prisma.computeRun.findFirstOrThrow({ where: { orgId, isCurrent: true } });
    const buggy: typeof allocate = (lines, config) => {
      const r = allocate(lines, config);
      r.pieces[0]!.amountCents += 1; // inject a one-cent leak
      return r;
    };
    const r = await recompute(orgId, { compute: buggy });
    expect(r.status).toBe('failed');
    expect(r.error).toMatch(/Allocation imbalance/);
    const failed = await prisma.computeRun.findUniqueOrThrow({ where: { id: r.runId } });
    expect(failed.status).toBe('failed');
    expect(failed.isCurrent).toBe(false);
    const still = await prisma.computeRun.findFirstOrThrow({ where: { orgId, isCurrent: true } });
    expect(still.id).toBe(current.id);
  });
});
