import path from 'node:path';
import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import { CsvDataSource } from '@/datasource/csv/adapter';
import { FULL_RANGE, runImport } from '@/datasource/import-service';
import { seedDemoOverlay } from '@/seed/demo-overlay';
import { recompute } from '@/engine/recompute';
import { prisma } from '@/lib/db';
import { loadReport } from '@/reports/query';
import { parseParams } from '@/reports/params';
import { cellId, pivot } from '@/reports/pivot';
import expected from '../../fixtures/demo/expected.json';
import { createTestOrg, resetDatabase } from './helpers';

describe('reports golden Q1', () => {
  let orgId: string, grantId: string;
  beforeAll(async () => {
    await resetDatabase();
    orgId = await createTestOrg();
    await runImport(
      orgId,
      new CsvDataSource({ dir: path.resolve(__dirname, '../../fixtures/demo') }),
      FULL_RANGE,
    );
    await seedDemoOverlay(orgId, path.resolve(__dirname, '../../fixtures/demo/overlay'));
    await recompute(orgId);
    grantId = (
      await prisma.grant.findFirstOrThrow({ where: { orgId, awardNumber: 'MWSC-2026-117' } })
    ).id;
  });
  afterAll(async () => {
    await prisma.$disconnect();
  });
  const period = 'from=2026-01-01&to=2026-03-31';
  it('Program × GL every expense cell, column total, row total and grand total equals golden', async () => {
    const params = parseParams(new URLSearchParams(`${period}&rows=glAccount&cols=program`));
    const { facts } = await loadReport(orgId, params);
    const expenses = facts.filter((f) => f.glAccountType === 'Expense');
    const table = pivot(expenses, params);
    for (const [gl, values] of Object.entries(expected.expenseByProgramGl)) {
      if (gl === 'total') continue;
      const key = table.rowKeys.find((k) => k.startsWith(`${gl} `))!;
      for (const [program, cents] of Object.entries(values)) {
        if (program === 'total') expect(table.rowTotals.get(key)).toBe(cents);
        else expect(table.cells.get(cellId(key, program)) ?? 0, `${gl}/${program}`).toBe(cents);
      }
    }
    for (const [program, cents] of Object.entries(expected.expenseByProgramGl.total)) {
      if (program === 'total') expect(table.grandTotal).toBe(cents);
      else expect(table.colTotals.get(program)).toBe(cents);
    }
  });
  it('MWSC PERS is 6010 + 6020 = 26,481.90 and drill-down sums to cell', async () => {
    const p = parseParams(
      new URLSearchParams(`${period}&rows=grantBudgetLine&cols=glAccount&grant=${grantId}`),
    );
    const { facts } = await loadReport(orgId, p),
      table = pivot(facts, p);
    const wages = table.colKeys.find((c) => c.startsWith('6010 '))!;
    const tax = table.colKeys.find((c) => c.startsWith('6020 '))!;
    expect(table.cells.get(cellId('PERS', wages))).toBe(2460000);
    expect(table.cells.get(cellId('PERS', tax))).toBe(188190);
    expect(table.rowTotals.get('PERS')).toBe(2648190);
    expect(
      facts
        .filter((f) => f.grantBudgetLine === 'PERS' && f.glAccount === wages)
        .reduce((n, f) => n + f.amountCents, 0),
    ).toBe(table.cells.get(cellId('PERS', wages)));
  });
  it('grant × program and monthly × budget line presets reconcile to golden grant actuals', async () => {
    const { facts } = await loadReport(orgId, parseParams(new URLSearchParams(period)));
    const byGrant = pivot(facts, { rows: 'grant', cols: 'program' });
    expect(byGrant.rowTotals.get('MWSC-2026-117')).toBe(
      expected.budgetVsActual['G-MWSC'].total.actual,
    );
    expect(byGrant.rowTotals.get('HCF-26-042')).toBe(expected.budgetVsActual['G-HCF'].total.actual);
    const monthly = pivot(
      facts.filter((f) => f.grant === 'MWSC-2026-117'),
      { rows: 'month', cols: 'grantBudgetLine' },
    );
    for (const [line, spec] of Object.entries(expected.budgetVsActual['G-MWSC'].lines))
      expect(monthly.colTotals.get(line)).toBe(spec.actual);
    expect(monthly.grandTotal).toBe(expected.budgetVsActual['G-MWSC'].total.actual);
  });
});
