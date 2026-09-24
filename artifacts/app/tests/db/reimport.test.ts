import path from 'node:path';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '@/lib/db';
import { CsvDataSource } from '@/datasource/csv/adapter';
import { FULL_RANGE, runImport } from '@/datasource/import-service';
import { recompute } from '@/engine/recompute';
import { seedDemoOverlay } from '@/seed/demo-overlay';
import expected from '../../fixtures/demo/expected-edited.json';
import { createTestOrg, resetDatabase } from './helpers';

const demo = path.resolve(__dirname, '../../fixtures/demo');
const edited = path.resolve(__dirname, '../../fixtures/demo-edited');
describe('incremental CSV re-import', () => {
  let orgId: string;
  beforeEach(async () => {
    await resetDatabase();
    orgId = await createTestOrg();
  });
  afterAll(() => prisma.$disconnect());

  it('identical full import is a no-op; edited import writes two versions and updated allocations', async () => {
    await runImport(orgId, new CsvDataSource({ dir: demo }), FULL_RANGE);
    const identical = await runImport(orgId, new CsvDataSource({ dir: demo }), FULL_RANGE);
    for (const entity of ['accounts', 'classes', 'locations', 'parties', 'transactions'] as const) {
      expect(
        identical.counts[entity].new +
          identical.counts[entity].changed +
          identical.counts[entity].deleted,
      ).toBe(0);
    }
    await seedDemoOverlay(orgId, path.join(demo, 'overlay'));
    const changed = await runImport(orgId, new CsvDataSource({ dir: edited }), FULL_RANGE);
    expect(changed.status).toBe('succeeded');
    expect(changed.counts.transactions.changed).toBe(expected.changed);
    expect(changed.counts.transactions.deleted).toBe(expected.deleted);
    expect(
      await prisma.sourceRowVersion.count({ where: { orgId, importBatchId: changed.batchId } }),
    ).toBe(2);
    expect(
      (
        await prisma.transaction.findFirstOrThrow({
          where: { orgId, externalId: 'BILL-UTIL-2026-03' },
        })
      ).deletedAt,
    ).not.toBeNull();
    const run = await recompute(orgId);
    expect(run.status).toBe('succeeded');
    const lines = await prisma.allocatedLine.findMany({
      where: {
        orgId,
        computeRunId: run.runId,
        program: { code: 'CT' },
        sourceLine: { account: { number: '6110' } },
      },
    });
    expect(lines.reduce((n, p) => n + p.amountCents, 0)).toBe(expected.ctFoodCents);
  });

  it('partial-range imports never soft-delete absent transactions', async () => {
    await runImport(orgId, new CsvDataSource({ dir: demo }), FULL_RANGE);
    const result = await runImport(
      orgId,
      new CsvDataSource({ dir: edited }),
      { from: new Date('2026-02-01'), to: new Date('2026-02-28') },
      { fullRange: false },
    );
    expect(result.status).toBe('succeeded');
    expect(result.counts.transactions.deleted).toBe(0);
    expect(
      (
        await prisma.transaction.findFirstOrThrow({
          where: { orgId, externalId: 'BILL-UTIL-2026-03' },
        })
      ).deletedAt,
    ).toBeNull();
  });

  it('trial balance passes and a one-cent discrepancy names its account', async () => {
    await runImport(orgId, new CsvDataSource({ dir: demo }), FULL_RANGE);
    await seedDemoOverlay(orgId, path.join(demo, 'overlay'));
    const run = await recompute(orgId);
    const initial = await prisma.computeRun.findUniqueOrThrow({ where: { id: run.runId } });
    expect(
      (initial.checks as { name: string; status: string }[]).find((c) => c.name === 'trial_balance')
        ?.status,
    ).toBe('pass');
    const source = new CsvDataSource({ dir: demo });
    const balance = await new CsvDataSource({
      dir: path.resolve(__dirname, '../../fixtures/demo-tb-mismatch'),
    }).fetchTrialBalance();
    source.fetchTrialBalance = async () => balance;
    await runImport(orgId, source, FULL_RANGE);
    const next = await recompute(orgId);
    const current = await prisma.computeRun.findUniqueOrThrow({ where: { id: next.runId } });
    expect(
      (current.checks as { name: string; status: string; detail: string }[]).find(
        (c) => c.name === 'trial_balance',
      ),
    ).toMatchObject({ status: 'fail', detail: expect.stringContaining('A6220') });
  });

  it('warns on incomplete trial balance and counts unassigned income pieces', async () => {
    const source = new CsvDataSource({ dir: demo });
    const balances = await source.fetchTrialBalance();
    source.fetchTrialBalance = async () => balances.slice(0, 2);
    await runImport(orgId, source, FULL_RANGE);
    await seedDemoOverlay(orgId, path.join(demo, 'overlay'));
    const run = await recompute(orgId);
    const saved = await prisma.computeRun.findUniqueOrThrow({ where: { id: run.runId } });
    const checks = saved.checks as { name: string; status: string; detail: string }[];
    expect(checks.find((c) => c.name === 'trial_balance')).toMatchObject({
      status: 'warn',
      detail: expect.stringContaining('2 of 7 expense accounts covered'),
    });
    expect(checks.find((c) => c.name === 'unassigned_program')).toMatchObject({
      status: 'warn',
      detail: expect.stringContaining('1 allocation pieces'),
    });
  });

  it('soft-deletes a removed line referenced by a closed run', async () => {
    await runImport(orgId, new CsvDataSource({ dir: demo }), FULL_RANGE);
    await seedDemoOverlay(orgId, path.join(demo, 'overlay'));
    const oldRun = await recompute(orgId);
    const oldLine = await prisma.transactionLine.findFirstOrThrow({
      where: { orgId, transaction: { externalId: 'JE-PR-2026-01' }, lineNumber: 1 },
    });
    const source = new CsvDataSource({ dir: demo });
    const original = source.fetchTransactions.bind(source);
    source.fetchTransactions = async function* (range) {
      for await (const txn of original(range))
        yield txn.externalId === 'JE-PR-2026-01'
          ? { ...txn, lines: txn.lines.filter((line) => line.lineNumber !== 1) }
          : txn;
    };
    const result = await runImport(orgId, source, FULL_RANGE);
    expect(result.status).toBe('succeeded');
    expect(
      (await prisma.transactionLine.findUniqueOrThrow({ where: { id: oldLine.id } })).deletedAt,
    ).not.toBeNull();
    expect(
      await prisma.allocatedLine.count({
        where: { orgId, computeRunId: oldRun.runId, sourceLineId: oldLine.id },
      }),
    ).toBeGreaterThan(0);
    const next = await recompute(orgId);
    expect(next.status).toBe('succeeded');
    expect(
      await prisma.allocatedLine.count({
        where: { orgId, computeRunId: next.runId, sourceLineId: oldLine.id },
      }),
    ).toBe(0);
  });
});
