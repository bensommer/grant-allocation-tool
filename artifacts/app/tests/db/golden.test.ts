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
import { recompute } from '@/engine/recompute';
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
    const run = await recompute(orgId);
    expect(run.status).toBe('succeeded');
    runId = run.runId;
  });
  let runId: string;

  async function programGl() {
    const rows = await prisma.allocatedLine.findMany({
      where: {
        computeRunId: runId,
        sourceLine: {
          account: { type: 'Expense' },
          transaction: {
            txnDate: { gte: new Date(expected.period.from), lte: new Date(expected.period.to) },
          },
        },
      },
      include: {
        program: { select: { code: true } },
        sourceLine: { include: { account: { select: { number: true } } } },
        grantBudgetLine: {
          select: { code: true, grant: { select: { awardNumber: true, name: true } } },
        },
      },
    });
    return rows;
  }

  it('program × GL figures match to the cent after recompute', async () => {
    const rows = await programGl();
    const cell = new Map<string, number>();
    for (const r of rows) {
      const k = `${r.sourceLine.account.number}|${r.program?.code ?? 'none'}`;
      cell.set(k, (cell.get(k) ?? 0) + r.amountCents);
    }
    for (const [gl, cells] of Object.entries(expected.expenseByProgramGl)) {
      if (gl === 'total') continue;
      for (const [prog, cents] of Object.entries(cells)) {
        if (prog === 'total') continue;
        expect(cell.get(`${gl}|${prog}`) ?? 0, `GL ${gl} × ${prog}`).toBe(cents);
      }
    }
    expect(rows.some((r) => r.status !== 'ok')).toBe(false);
  });

  it('March utilities split is CT 300.01 / YM 120.00 / MG 180.00', async () => {
    const txn = await prisma.transaction.findFirstOrThrow({
      where: { orgId, externalId: expected.roundingCheck.txnExternalId },
      include: {
        lines: {
          include: { allocated: { where: { computeRunId: runId }, include: { program: true } } },
        },
      },
    });
    const util = txn.lines.find((l) => l.allocated.length === 3)!;
    expect(util.amountCents).toBe(expected.roundingCheck.amount);
    expect(Object.fromEntries(util.allocated.map((a) => [a.program!.code, a.amountCents]))).toEqual(
      expected.roundingCheck.split,
    );
  });

  it('budget vs actual per grant budget line matches', async () => {
    const rows = await programGl();
    const actual = new Map<string, number>();
    for (const r of rows) {
      if (!r.grantBudgetLine) continue;
      const g = r.grantBudgetLine.grant.awardNumber === 'MWSC-2026-117' ? 'G-MWSC' : 'G-HCF';
      const k = `${g}|${r.grantBudgetLine.code}`;
      actual.set(k, (actual.get(k) ?? 0) + r.amountCents);
    }
    for (const [g, spec] of Object.entries(expected.budgetVsActual)) {
      let total = 0;
      for (const [code, line] of Object.entries(spec.lines)) {
        expect(actual.get(`${g}|${code}`) ?? 0, `${g}/${code}`).toBe(line.actual);
        total += line.actual;
      }
      expect(total).toBe(spec.total.actual);
    }
  });

  it('unmapped YM occupancy and non-grant functional expense match', async () => {
    const rows = await programGl();
    const ym = rows.filter((r) => r.program?.code === 'YM' && !r.grantBudgetLine);
    const byGl = new Map<string, number>();
    for (const r of ym)
      byGl.set(
        r.sourceLine.account.number!,
        (byGl.get(r.sourceLine.account.number!) ?? 0) + r.amountCents,
      );
    expect(byGl.get('6210')).toBe(expected.unmappedProgramExpense.YM['6210']);
    expect(byGl.get('6220')).toBe(expected.unmappedProgramExpense.YM['6220']);
    expect(ym.reduce((a, r) => a + r.amountCents, 0)).toBe(
      expected.unmappedProgramExpense.YM.total,
    );
    const mg = rows.filter((r) => r.program?.code === 'MG').reduce((a, r) => a + r.amountCents, 0);
    const fr = rows.filter((r) => r.program?.code === 'FR').reduce((a, r) => a + r.amountCents, 0);
    expect(mg).toBe(expected.unmappedProgramExpense.nonGrantFunctional.MG);
    expect(fr).toBe(expected.unmappedProgramExpense.nonGrantFunctional.FR);
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
