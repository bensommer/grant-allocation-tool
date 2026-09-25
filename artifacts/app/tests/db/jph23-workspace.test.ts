/**
 * JPH-23 Phase 4 — grant workspace read models.
 *
 * AC5 Opioid activity grid (remaining per remaining occurrence, over-budget rows)
 * AC7 Salah funder view per D1 branch, plus its XLSX/PDF tables
 * Header metrics on the overview.
 * Expected values come from JPH-19 §7 / JPH-23; they are not derived here.
 */
import path from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import ExcelJS from 'exceljs';
import { prisma } from '@/lib/db';
import { utcDate } from '@/domain/dates';
import { recompute } from '@/engine/recompute';
import { funderViewTable, funderViewXlsx } from '@/reports/funder-view';
import { budgetTree } from '@/services/grant-budget';
import {
  activityGrid,
  forecast,
  grantHeader,
  headerMetrics,
  workingView,
} from '@/services/grant-workspace';
import { recordDecision } from '@/services/line-decisions';
import { reviewQueue } from '@/services/review';
import { seedPilot } from '@/seed/pilot';
import { createTestOrg, resetDatabase } from './helpers';

const SEED = path.resolve(__dirname, '../../fixtures/pilot/seed.json');
const AS_OF = utcDate(2026, 9, 22);

let orgId: string;
let salahId: string;
let opioidId: string;

beforeAll(async () => {
  await resetDatabase();
  orgId = await createTestOrg();
  const summary = await seedPilot(orgId, SEED);
  salahId = summary.grants.find((g) => g.key === 'salah')!.grantId;
  opioidId = summary.grants.find((g) => g.key === 'opioid')!.grantId;
  const r = await recompute(orgId);
  expect(r.status, r.error).toBe('succeeded');
}, 300_000);

async function decideD1(kind: 'assign' | 'exclude') {
  const queue = await reviewQueue(orgId, salahId);
  const d1 = new Set(queue.decisions.filter((d) => /^D1-/.test(d.reason ?? '')).map((d) => d.id));
  const lineIds = [
    ...queue.groups.flatMap((g) => g.lines.map((l) => l.id)),
    ...[...queue.assigned, ...queue.excluded]
      .filter((l) => l.decisionId && d1.has(l.decisionId))
      .map((l) => l.id),
  ];
  const leah = await prisma.grantBudgetLine.findFirstOrThrow({
    where: { grantId: salahId, code: 'LEAH' },
  });
  await recordDecision(
    orgId,
    salahId,
    {
      kind,
      lineIds,
      targetBudgetLineId: kind === 'assign' ? leah.id : null,
      reason: kind === 'assign' ? 'D1-A' : 'D1-B',
      note: `${kind === 'assign' ? 'D1-A' : 'D1-B'}: pre-September Leah pay.`,
    },
    'test',
  );
  const r = await recompute(orgId);
  expect(r.status, r.error).toBe('succeeded');
}

describe('AC5 Opioid activity grid', () => {
  it('columns are the funder categories with cells; food and supplies share one column', async () => {
    const grid = activityGrid(await budgetTree(orgId, opioidId));
    expect(grid.columns.map((c) => c.code)).toEqual([
      'PRACT',
      'FACADMIN',
      'COORD',
      'SUPPORT',
      'FOODSUPP',
    ]);
    expect(grid.rows.map((r) => r.name)).toEqual([
      "Daytime Mother's",
      'Conference',
      'Teen Monthly',
      "Mother's Exhaustion (virtual)",
      'Sober Socials',
    ]);
    expect(grid.unassignedCells).toEqual([]);
  });

  it('remaining per remaining occurrence: Teen 400.00 / 105.33, Sober Socials 300.00 / 290.63, others blank', async () => {
    const grid = activityGrid(await budgetTree(orgId, opioidId));
    const cell = (activity: string, code: string) => {
      const row = grid.rows.find((r) => r.name === activity)!;
      const i = grid.columns.findIndex((c) => c.code === code);
      return row.cells[i]!;
    };
    expect(cell('Teen Monthly', 'PRACT').perOccurrenceCents).toBe(40000);
    expect(cell('Teen Monthly', 'FOODSUPP').perOccurrenceCents).toBe(10533);
    expect(cell('Sober Socials', 'PRACT').perOccurrenceCents).toBe(30000);
    expect(cell('Sober Socials', 'FOODSUPP').perOccurrenceCents).toBe(29063);
    for (const a of ["Daytime Mother's", 'Conference', "Mother's Exhaustion (virtual)"])
      for (const c of grid.columns) expect(cell(a, c.code).perOccurrenceCents).toBeNull();
    expect(grid.rows.find((r) => r.name === 'Teen Monthly')!.plannedCount).toBe(10);
    expect(grid.rows.find((r) => r.name === 'Teen Monthly')!.completedCount).toBe(6);
  });

  it("Mother's Exhaustion food & supplies is over by 152.89 on its own row", async () => {
    const grid = activityGrid(await budgetTree(orgId, opioidId));
    const i = grid.columns.findIndex((c) => c.code === 'FOODSUPP');
    const row = grid.rows.find((r) => r.name === "Mother's Exhaustion (virtual)")!;
    expect(row.cells[i]!.remainingCents).toBe(-15289);
    expect(row.cells[i]!.overBudget).toBe(true);
  });

  it('Program Support over by 346.53 in total (Teen −496.09, Sober Socials −0.44); totals are plain sums', async () => {
    const grid = activityGrid(await budgetTree(orgId, opioidId));
    const i = grid.columns.findIndex((c) => c.code === 'SUPPORT');
    expect(grid.rows.find((r) => r.name === 'Teen Monthly')!.cells[i]!.remainingCents).toBe(-49609);
    expect(grid.rows.find((r) => r.name === 'Sober Socials')!.cells[i]!.remainingCents).toBe(-44);
    expect(grid.totals[i]!.remainingCents).toBe(-34653);
    expect(grid.totals[i]!.remainingCents).toBe(
      grid.rows.reduce((s, r) => s + r.cells[i]!.remainingCents, 0),
    );
  });

  it("Coordinator 876.97 remaining in total; Daytime Mother's −798.93 and Conference −247.77 stay on their rows", async () => {
    const grid = activityGrid(await budgetTree(orgId, opioidId));
    const i = grid.columns.findIndex((c) => c.code === 'COORD');
    expect(grid.totals[i]!.remainingCents).toBe(87697);
    expect(grid.rows.find((r) => r.name === "Daytime Mother's")!.cells[i]!.remainingCents).toBe(
      -79893,
    );
    expect(grid.rows.find((r) => r.name === 'Conference')!.cells[i]!.remainingCents).toBe(-24777);
  });
});

describe('AC7 Salah funder view', () => {
  const byCode = async () => {
    const tree = await budgetTree(orgId, salahId);
    return Object.fromEntries(tree.all.map((l) => [l.code, l.chargedCents]));
  };

  it('D1-A: Culinary Staff 2,530.47 (Leah 2,095.47); other categories 13,755.62 / 929.62 / 5,493.10', async () => {
    await decideD1('assign');
    const c = await byCode();
    expect(c['CULINARY']).toBe(253047);
    expect(c['LEAH']).toBe(209547);
    expect(c['FAC']).toBe(1375562);
    expect(c['FOODBEV']).toBe(92962);
    expect(c['SUPPLIES']).toBe(549310);
  });

  it('D1-B: Culinary Staff 1,342.06 (Leah 907.06); other categories unchanged', async () => {
    await decideD1('exclude');
    const c = await byCode();
    expect(c['CULINARY']).toBe(134206);
    expect(c['LEAH']).toBe(90706);
    expect(c['FAC']).toBe(1375562);
    expect(c['FOODBEV']).toBe(92962);
    expect(c['SUPPLIES']).toBe(549310);
    await decideD1('assign');
  });

  it('the XLSX and PDF table carry the same category totals as the page', async () => {
    const grant = (await grantHeader(orgId, salahId))!;
    const tree = await budgetTree(orgId, salahId);
    const table = funderViewTable(grant, tree, AS_OF);
    const culinary = table.rows.find((r) => r[0] === 'Culinary Staff')!;
    expect(culinary[2]).toBe(253047);
    expect(table.totals![2]).toBe(tree.totals.chargedCents);
    const buf = await funderViewXlsx(grant, tree, AS_OF);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buf as unknown as ArrayBuffer);
    const ws = wb.worksheets[0]!;
    const found: number[] = [];
    ws.eachRow((row) => {
      const v = row.getCell(3).value;
      if (typeof v === 'number') found.push(Math.round(v * 100));
    });
    expect(found).toContain(253047);
    expect(found).toContain(1375562);
  });
});

describe('header metrics', () => {
  it('Opioid: award 20,000, received 20,000, spent = assigned + effort, balance = received − spent', async () => {
    const grant = (await grantHeader(orgId, opioidId))!;
    const tree = await budgetTree(orgId, opioidId);
    const m = await headerMetrics(orgId, grant, AS_OF);
    expect(m.awardCents).toBe(2000000);
    expect(m.receivedCents).toBe(2000000);
    expect(m.spentCents).toBe(tree.totals.chargedCents);
    expect(m.spentCents).toBe(1628610);
    expect(m.restrictedBalanceCents).toBe(2000000 - 1628610);
    expect(m.elapsedBps).toBeGreaterThan(9000);
    expect(m.elapsedBps).toBeLessThanOrEqual(10000);
    expect(m.projectedAtEndCents).toBeGreaterThan(m.spentCents);
  });

  it('Salah working view spreads remaining over the months left; a forecast adds count × hours × rate', async () => {
    const grant = (await grantHeader(orgId, salahId))!;
    const tree = await budgetTree(orgId, salahId);
    const wv = workingView(tree, grant, AS_OF);
    expect(wv.months).toBe(5.3);
    const fac = wv.categories.find((c) => c.category.code === 'FAC')!;
    expect(fac.remainingCents).toBe(2940000 - 1375562);
    expect(fac.perMonthCents).toBe(Math.round((2940000 - 1375562) / 5.3));
    const kira = fac.rows.find((r) => r.line.code === 'KIRA')!;
    const f = forecast(kira.line.chargedCents, kira.line.currentCents, utcDate(2026, 9, 30), [
      { count: 14, hours: '2', rate: '36.06' },
    ]);
    expect(f.plannedCents).toBe(100968);
    expect(f.projectedCents).toBe(kira.line.chargedCents + 100968);
  });
});
