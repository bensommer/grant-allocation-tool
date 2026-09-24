/**
 * Golden suite (JPH-7). Gate for stories 07/08/09: every number in
 * fixtures/demo/expected.json must hold after import + seed (+ compute once
 * the allocation engine exists — those assertions are appended in JPH-10).
 */
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '@/lib/db';
import { CsvDataSource } from '@/datasource/csv/adapter';
import { FULL_RANGE, runImport } from '@/datasource/import-service';
import { seedDemoOverlay } from '@/seed/demo-overlay';
import expected from '../../fixtures/demo/expected.json';
import { createTestOrg, resetDatabase } from './helpers';

const DEMO = path.resolve(__dirname, '../../fixtures/demo');

describe('golden dataset — Harbor Kitchen Collective Q1 2026', () => {
  let orgId: string;
  beforeAll(async () => {
    await resetDatabase();
    orgId = await createTestOrg();
    const r = await runImport(orgId, new CsvDataSource({ dir: DEMO }), FULL_RANGE);
    expect(r.status).toBe('succeeded');
    const seeded = await seedDemoOverlay(orgId, path.join(DEMO, 'overlay'));
    expect(seeded).toEqual(expected.overlayCounts);
  });
  afterAll(() => prisma.$disconnect());

  it('source totals per GL account match the golden table totals column', async () => {
    const rows = await prisma.transactionLine.groupBy({
      by: ['accountId'],
      _sum: { amountCents: true },
      where: {
        orgId,
        account: { type: 'Expense' },
        transaction: {
          txnDate: { gte: new Date(expected.period.from), lte: new Date(expected.period.to) },
        },
      },
    });
    const accounts = await prisma.account.findMany({
      where: { orgId },
      select: { id: true, number: true },
    });
    const numById = new Map(accounts.map((a) => [a.id, a.number!]));
    const byGl: Record<string, number> = Object.fromEntries(
      rows.map((r) => [numById.get(r.accountId)!, r._sum.amountCents ?? 0]),
    );
    for (const [gl, cells] of Object.entries(expected.expenseByProgramGl)) {
      if (gl === 'total') continue;
      expect(byGl[gl], `GL ${gl}`).toBe(cells.total);
    }
    const total = Object.values(byGl).reduce((a, b) => a + b, 0);
    expect(total).toBe(expected.expenseByProgramGl.total.total);
  });

  it('overlay seed produced the documented programs, grants and budget lines', async () => {
    const programs = await prisma.program.findMany({ where: { orgId }, orderBy: { code: 'asc' } });
    expect(programs.map((p) => p.code)).toEqual(['CT', 'FR', 'MG', 'YM']);
    const grants = await prisma.grant.findMany({
      where: { orgId },
      include: { budgetLines: true },
    });
    const mwsc = grants.find((g) => g.name === 'Culinary Workforce Grant')!;
    expect(mwsc.awardAmountCents).toBe(expected.budgetVsActual['G-MWSC'].total.budget);
    expect(mwsc.budgetLines.reduce((a, b) => a + b.budgetCents, 0)).toBe(
      expected.budgetVsActual['G-MWSC'].total.budget,
    );
    const hcf = grants.find((g) => g.name === 'Youth Meals Grant')!;
    expect(hcf.budgetLines.map((b) => b.code).sort()).toEqual(['MEALS', 'STAFF']);
    const rff = grants.find((g) => g.name.startsWith('Rivera'))!;
    expect(rff.restrictionType).toBe('unrestricted');
    expect(rff.budgetLines).toHaveLength(0);
  });

  it('restricted grant receipts match the golden received amounts', async () => {
    for (const code of ['G-MWSC', 'G-HCF'] as const) {
      const exp = expected.restrictedBalances[code];
      const grant = await prisma.grant.findFirstOrThrow({
        where: { orgId, awardNumber: code === 'G-MWSC' ? 'MWSC-2026-117' : 'HCF-26-042' },
      });
      const received = await prisma.transactionLine.aggregate({
        _sum: { amountCents: true },
        where: {
          orgId,
          account: { type: 'Income' },
          OR: [
            { partyId: { in: grant.matchPartyIds } },
            { transaction: { partyId: { in: grant.matchPartyIds } } },
          ],
        },
      });
      expect(received._sum.amountCents).toBe(exp.received);
    }
  });
});
