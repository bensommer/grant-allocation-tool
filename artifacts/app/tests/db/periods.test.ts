import path from 'node:path';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '@/lib/db';
import { CsvDataSource } from '@/datasource/csv/adapter';
import { FULL_RANGE, runImport } from '@/datasource/import-service';
import { recompute } from '@/engine/recompute';
import { seedDemoOverlay } from '@/seed/demo-overlay';
import { lockPeriod, periodDrift } from '@/services/periods';
import expected from '../../fixtures/demo/expected-edited.json';
import { createTestOrg, resetDatabase } from './helpers';

const demo = path.resolve(__dirname, '../../fixtures/demo');
describe('reporting locks and drift', () => {
  let orgId: string;
  beforeEach(async () => {
    await resetDatabase();
    orgId = await createTestOrg();
  });
  afterAll(() => prisma.$disconnect());
  it('flags the locked period and compares immutable allocation amounts', async () => {
    await runImport(orgId, new CsvDataSource({ dir: demo }), FULL_RANGE);
    await seedDemoOverlay(orgId, path.join(demo, 'overlay'));
    const original = await recompute(orgId);
    const lock = await lockPeriod(
      orgId,
      'Q1 2026',
      new Date('2026-01-01'),
      new Date('2026-03-31'),
      'Reported',
    );
    expect(lock.computeRunId).toBe(original.runId);
    const result = await runImport(
      orgId,
      new CsvDataSource({ dir: path.resolve(__dirname, '../../fixtures/demo-edited') }),
      FULL_RANGE,
    );
    const batch = await prisma.importBatch.findUniqueOrThrow({ where: { id: result.batchId } });
    expect((batch.counts as { lockIds: string[] }).lockIds).toContain(lock.id);
    await recompute(orgId);
    const drift = await periodDrift(orgId, lock.id);
    expect(drift?.affected.map((v) => v.externalId).sort()).toEqual([
      'BILL-UTIL-2026-03',
      'EXP-FOOD-CT-2026-02',
    ]);
    expect(
      drift?.deltas.find((d) => d.program === 'CT' && d.gl === '6110')?.after! -
        drift?.deltas.find((d) => d.program === 'CT' && d.gl === '6110')?.before!,
    ).toBe(10000);
    for (const [program, cents] of Object.entries(expected.utilitiesDeltaCents)) {
      const cell = drift?.deltas.find((d) => d.program === program && d.gl === '6220');
      expect(cell!.after - cell!.before).toBe(cents);
    }
  });
  it('flags a late Q1 transaction and lists it in drift', async () => {
    await runImport(orgId, new CsvDataSource({ dir: demo }), FULL_RANGE);
    await seedDemoOverlay(orgId, path.join(demo, 'overlay'));
    await recompute(orgId);
    const lock = await lockPeriod(
      orgId,
      'Q1 2026',
      new Date('2026-01-01'),
      new Date('2026-03-31'),
      'Reported',
    );
    const source = new CsvDataSource({ dir: demo });
    const original = source.fetchTransactions.bind(source);
    source.fetchTransactions = async function* (range) {
      for await (const txn of original(range)) {
        yield txn;
        if (txn.externalId === 'EXP-FOOD-CT-2026-02')
          yield { ...txn, externalId: 'EXP-LATE-CT-2026-02', docNumber: 'LATE-02' };
      }
    };
    const result = await runImport(orgId, source, FULL_RANGE);
    expect(result.status).toBe('succeeded');
    expect(result.counts.transactions.new).toBe(1);
    const batch = await prisma.importBatch.findUniqueOrThrow({ where: { id: result.batchId } });
    const counts = batch.counts as { lockIds: string[]; lockNewIds: Record<string, string[]> };
    expect(counts.lockIds).toContain(lock.id);
    expect(counts.lockNewIds[lock.id]).toContain('EXP-LATE-CT-2026-02');
    await recompute(orgId);
    const drift = await periodDrift(orgId, lock.id);
    expect(drift?.added.map((row) => row.externalId)).toContain('EXP-LATE-CT-2026-02');
  });
});
