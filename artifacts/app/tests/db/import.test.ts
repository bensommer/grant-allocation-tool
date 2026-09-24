import path from 'node:path';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '@/lib/db';
import { CsvDataSource } from '@/datasource/csv/adapter';
import { FULL_RANGE, runImport } from '@/datasource/import-service';
import expected from '../../fixtures/demo/expected.json';
import expectedErrors from '../../fixtures/broken/EXPECTED_ERRORS.json';
import { createTestOrg, resetDatabase } from './helpers';

const DEMO = path.resolve(__dirname, '../../fixtures/demo');
const BROKEN = path.resolve(__dirname, '../../fixtures/broken');

describe('CSV adapter + ImportService (JPH-6)', () => {
  let orgId: string;
  beforeEach(async () => {
    await resetDatabase();
    orgId = await createTestOrg();
  });
  afterAll(() => prisma.$disconnect());

  it('imports the demo fixture with the documented counts', async () => {
    const r = await runImport(orgId, new CsvDataSource({ dir: DEMO }), FULL_RANGE);
    expect(r.errors).toEqual([]);
    expect(r.status).toBe('succeeded');
    const c = expected.importCounts;
    expect(r.counts.accounts.new).toBe(c.accounts);
    expect(r.counts.classes.new).toBe(c.classes);
    expect(r.counts.locations.new).toBe(c.locations);
    expect(r.counts.parties.new).toBe(c.parties);
    expect(r.counts.transactions.new).toBe(c.transactions);
    expect(r.counts.lines).toBe(c.lines);
    expect(await prisma.transactionLine.count()).toBe(c.lines);

    const org = await prisma.org.findUniqueOrThrow({ where: { id: orgId } });
    expect(org.name).toBe(expected.org.name);

    // Sign convention: expense debits positive, income credits positive, asset credit negative.
    const util = await prisma.transactionLine.findFirstOrThrow({
      where: { transaction: { externalId: 'BILL-UTIL-2026-03' } },
    });
    expect(util.amountCents).toBe(60001);
    const dep = await prisma.transactionLine.findFirstOrThrow({
      where: { transaction: { externalId: 'DEP-MWSC-2026-01' } },
    });
    expect(dep.amountCents).toBe(6_000_000);
    const jeCredit = await prisma.transactionLine.findFirstOrThrow({
      where: { transaction: { externalId: 'JE-PR-2026-01' }, postingType: 'credit' },
    });
    expect(jeCredit.amountCents).toBe(-1_830_050);

    // Total expense across all lines to expense accounts = 77,118.61
    const agg = await prisma.transactionLine.aggregate({
      _sum: { amountCents: true },
      where: { account: { type: 'Expense' } },
    });
    expect(agg._sum.amountCents).toBe(expected.expenseByProgramGl.total.total);

    const batch = await prisma.importBatch.findUniqueOrThrow({ where: { id: r.batchId } });
    expect(batch.status).toBe('succeeded');
    expect(Object.keys(batch.fileHashes as object)).toHaveLength(6);
  });

  it('re-importing identical files is idempotent (0 new, N unchanged)', async () => {
    await runImport(orgId, new CsvDataSource({ dir: DEMO }), FULL_RANGE);
    const r = await runImport(orgId, new CsvDataSource({ dir: DEMO }), FULL_RANGE);
    expect(r.status).toBe('succeeded');
    for (const e of ['accounts', 'classes', 'locations', 'parties', 'transactions'] as const) {
      expect(r.counts[e].new).toBe(0);
      expect(r.counts[e].changed).toBe(0);
      expect(r.counts[e].deleted).toBe(0);
    }
    expect(r.counts.transactions.unchanged).toBe(expected.importCounts.transactions);
    expect(await prisma.transaction.count()).toBe(expected.importCounts.transactions);
    expect(await prisma.transactionLine.count()).toBe(expected.importCounts.lines);
    expect(await prisma.sourceRowVersion.count()).toBe(0);
  });

  it('broken fixture yields exactly the documented errors and commits nothing', async () => {
    const r = await runImport(orgId, new CsvDataSource({ dir: BROKEN }), FULL_RANGE);
    expect(r.status).toBe('failed');
    const got = r.errors.map((e) => ({
      file: e.file,
      row: e.row,
      column: e.column,
      code: e.code,
      message: e.message,
    }));
    expect(got).toHaveLength(expectedErrors.length);
    for (const exp of expectedErrors) {
      const match = got.find(
        (g) => g.code === exp.code && g.file === exp.file && g.message.includes(exp.match),
      );
      expect(match, `expected error ${exp.code} (${exp.match})`).toBeDefined();
      expect(match!.column).toBe(exp.column);
      if (match!.row !== null) expect(match!.row).toBe(exp.row);
    }
    expect(await prisma.account.count()).toBe(0);
    expect(await prisma.transaction.count()).toBe(0);
    const batch = await prisma.importBatch.findUniqueOrThrow({ where: { id: r.batchId } });
    expect(batch.status).toBe('failed');
    expect((batch.errors as unknown[]).length).toBe(expectedErrors.length);
  });
});
