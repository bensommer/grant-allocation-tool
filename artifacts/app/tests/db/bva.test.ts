import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '@/lib/db';
import { CsvDataSource } from '@/datasource/csv/adapter';
import { FULL_RANGE, runImport } from '@/datasource/import-service';
import { seedDemoOverlay } from '@/seed/demo-overlay';
import { recompute } from '@/engine/recompute';
import { bvaData } from '@/services/bva';
import { formatPct1 } from '@/domain/money';
import expected from '../../fixtures/demo/expected.json';
import { createTestOrg, resetDatabase } from './helpers';

describe('budget vs actual golden', () => {
  let orgId: string;
  beforeAll(async () => {
    await resetDatabase();
    orgId = await createTestOrg();
    expect(
      (
        await runImport(
          orgId,
          new CsvDataSource({ dir: path.resolve(__dirname, '../../fixtures/demo') }),
          FULL_RANGE,
        )
      ).status,
    ).toBe('succeeded');
    await seedDemoOverlay(orgId, path.resolve(__dirname, '../../fixtures/demo/overlay'));
    expect((await recompute(orgId)).status).toBe('succeeded');
  });
  afterAll(() => prisma.$disconnect());
  const asOf = new Date('2026-03-31');
  it('matches each line and total budget, actual, remaining and percent', async () => {
    const { grants } = await bvaData(orgId, asOf);
    for (const [key, spec] of Object.entries(expected.budgetVsActual)) {
      const grant = grants.find(
        (g) => g.awardNumber === (key === 'G-MWSC' ? 'MWSC-2026-117' : 'HCF-26-042'),
      )!;
      for (const [code, gold] of Object.entries(spec.lines)) {
        const line = grant.rows.find((r) => r.code === code)!;
        expect({
          budget: line.budgetCents,
          actual: line.actual,
          remaining: line.remaining,
          pctUsed: formatPct1(line.actual, line.budgetCents),
        }).toEqual(gold);
      }
      expect({
        budget: grant.budget,
        actual: grant.actual,
        remaining: grant.remaining,
        pctUsed: formatPct1(grant.actual, grant.budget),
      }).toEqual(spec.total);
    }
  });
  it('matches restricted balances and flags both grants at golden pacing', async () => {
    const { grants } = await bvaData(orgId, asOf);
    expect(grants.filter((g) => g.flagged)).toHaveLength(2);
    expect(grants.filter((g) => g.restrictionType !== 'unrestricted')).toHaveLength(2);
    for (const [award, balance, expectedCents, varianceCents, pct] of [
      ['MWSC-2026-117', 2024709, 2958904, 1016387, '34.4%'],
      ['HCF-26-042', 361880, 1232877, 905243, '73.4%'],
    ] as const) {
      const g = grants.find((g) => g.awardNumber === award)!;
      expect(g.balance).toBe(balance);
      expect(g.pace).toMatchObject({
        elapsedDays: 90,
        totalDays: 365,
        expectedCents,
        varianceCents,
        variancePct: pct,
        flag: 'over',
      });
    }
  });
  it('flags a line overspend even when total grant is under budget', async () => {
    const initial = await bvaData(orgId, asOf);
    const grant = initial.grants.find((g) => g.awardNumber === 'MWSC-2026-117')!;
    const row = grant.rows.find((r) => r.code === 'CONT')!;
    await prisma.grantBudgetLine.update({
      where: { id: row.id },
      data: { budgetCents: row.actual - 1 },
    });
    const updated = (await bvaData(orgId, asOf)).grants.find((g) => g.id === grant.id)!;
    expect(updated.actual).toBeLessThan(updated.budget);
    expect(updated.rows.find((r) => r.id === row.id)?.overBudget).toBe(true);
  });
});
