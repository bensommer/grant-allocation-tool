/**
 * JPH-30 Phase 0 — one set of grant figures.
 *
 * AC7: `grantFigures` returns the golden numbers for the demo (crosswalk-tracked)
 * and pilot (membership-tracked) grants, and the pages' wrappers agree with it.
 * Expected values come from fixtures/demo/expected.json and JPH-19 §7 / JPH-23;
 * nothing here derives them.
 */
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '@/lib/db';
import { CsvDataSource } from '@/datasource/csv/adapter';
import { FULL_RANGE, runImport } from '@/datasource/import-service';
import { utcDate } from '@/domain/dates';
import { recompute } from '@/engine/recompute';
import { seedDemoOverlay } from '@/seed/demo-overlay';
import { seedPilot } from '@/seed/pilot';
import { bvaData } from '@/services/bva';
import { budgetTree } from '@/services/grant-budget';
import { allGrantFigures, grantFiguresFor, grantTracking } from '@/services/grant-figures';
import { grantRollforward, rollforward } from '@/services/grant-periods';
import { effortSummary } from '@/services/effort';
import { grantHeader, headerMetrics } from '@/services/grant-workspace';
import { pacingSettings } from '@/services/settings';
import expected from '../../fixtures/demo/expected.json';
import { createTestOrg, resetDatabase } from './helpers';

const DEMO = path.resolve(__dirname, '../../fixtures/demo');
const PILOT_SEED = path.resolve(__dirname, '../../fixtures/pilot/seed.json');

afterAll(() => prisma.$disconnect());

describe('demo grants (crosswalk-tracked)', () => {
  let orgId: string;
  const AS_OF = utcDate(2026, 3, 31);
  const byAward = { 'G-MWSC': 'MWSC-2026-117', 'G-HCF': 'HCF-26-042' } as const;

  beforeAll(async () => {
    await resetDatabase();
    orgId = await createTestOrg();
    expect((await runImport(orgId, new CsvDataSource({ dir: DEMO }), FULL_RANGE)).status).toBe(
      'succeeded',
    );
    await seedDemoOverlay(orgId, path.resolve(DEMO, 'overlay'));
    expect((await recompute(orgId)).status).toBe('succeeded');
  }, 300_000);

  it('every demo grant is crosswalk-tracked and says so', async () => {
    const all = await allGrantFigures(orgId, AS_OF);
    expect(all).toHaveLength(3);
    for (const g of all) {
      expect(g.mode).toBe('crosswalk');
      expect((await grantTracking(orgId, g.grant.id))?.label).toBe('Tracked by crosswalk rules');
    }
  });

  it('spent, received and balance match expected.json for both restricted grants', async () => {
    const all = await allGrantFigures(orgId, AS_OF);
    for (const [key, gold] of Object.entries(expected.restrictedBalances)) {
      if (key === 'asOf' || key === 'excluded') continue;
      const g = all.find((x) => x.grant.awardNumber === byAward[key as keyof typeof byAward])!;
      const spec = gold as { balance: number; received: number; spent: number };
      expect(g.figures.spentCents).toBe(spec.spent);
      expect(g.figures.receivedCents).toBe(spec.received);
      expect(g.figures.restrictedBalanceCents).toBe(spec.balance);
      expect(g.figures.remainingAwardCents).toBe(g.grant.awardAmountCents - spec.spent);
    }
  });

  it('spent by budget line matches the BvA golden lines and sums to the grant total', async () => {
    const all = await allGrantFigures(orgId, AS_OF);
    for (const [key, spec] of Object.entries(expected.budgetVsActual)) {
      const g = all.find((x) => x.grant.awardNumber === byAward[key as keyof typeof byAward])!;
      for (const [code, gold] of Object.entries(spec.lines)) {
        const line = g.figures.spentByBudgetLine.find((l) => l.code === code)!;
        expect({
          budget: line.budgetCents,
          actual: line.chargedCents,
          remaining: line.remainingCents,
        }).toEqual({ budget: gold.budget, actual: gold.actual, remaining: gold.remaining });
      }
      expect(g.figures.budgetCents).toBe(spec.total.budget);
      expect(g.figures.spentByBudgetLine.reduce((n, l) => n + l.chargedCents, 0)).toBe(
        g.figures.spentCents,
      );
      expect(g.figures.spentCents).toBe(spec.total.actual);
    }
  });

  it('Culinary pacing is the golden straight line: expected 2,958,904, variance 1,016,387', async () => {
    const all = await allGrantFigures(orgId, AS_OF);
    const mwsc = all.find((x) => x.grant.awardNumber === 'MWSC-2026-117')!.figures;
    expect(mwsc.expectedCents).toBe(2958904);
    expect(mwsc.pacing.varianceCents).toBe(1016387);
    expect(mwsc.pacing.variancePct).toBe('34.4%');
    expect(mwsc.flagged).toBe(true);
    expect(mwsc.needsReviewCount).toBe(0);
    expect(mwsc.effortCents).toBe(0);
  });

  it('the overview header, the BvA report and the budget tree read the same spend', async () => {
    const mwsc = (await allGrantFigures(orgId, AS_OF)).find(
      (x) => x.grant.awardNumber === 'MWSC-2026-117',
    )!;
    const header = await headerMetrics(orgId, mwsc.grant, AS_OF);
    expect(header.spentCents).toBe(3975291);
    expect(header.receivedCents).toBe(6000000);
    expect(header.restrictedBalanceCents).toBe(2024709);
    const bva = (await bvaData(orgId, AS_OF, mwsc.grant.id)).grants[0]!;
    expect(bva.actual).toBe(header.spentCents);
    expect(bva.received).toBe(header.receivedCents);
    expect(bva.balance).toBe(header.restrictedBalanceCents);
    expect(bva.pace.expectedCents).toBe(mwsc.figures.expectedCents);
    const tree = await budgetTree(orgId, mwsc.grant.id, AS_OF);
    expect(tree.totals.chargedCents).toBe(3975291);
    expect(tree.totals.budgetCents).toBe(12000000);
    const effort = await effortSummary(orgId, mwsc.grant.id);
    expect(effort.totalChargedCents).toBe(3975291);
    // Rollforward through the same date: released = spent, ending = received − spent.
    const rf = await grantRollforward(orgId, mwsc.grant.id, utcDate(2026, 1, 1), AS_OF);
    expect(rf.released.direct + rf.released.staff + rf.released.overhead).toBe(3975291);
    expect(rf.receivedCents).toBe(6000000);
    expect(rf.endingCents).toBe(2024709);
    const org = await prisma.org.findUniqueOrThrow({ where: { id: orgId } });
    expect(pacingSettings(org.settings)).toEqual({ underPercent: 15, overPercent: 10 });
  });

  it('the org rollforward through 2026-03-31 carries the two restricted grants (not the unrestricted gift) and totals 2,386,589', async () => {
    const rf = await rollforward(orgId, utcDate(2026, 1, 1), AS_OF);
    expect(rf.rows.map((r) => r.name)).toEqual(['Culinary Workforce Grant', 'Youth Meals Grant']);
    const mwsc = rf.rows.find((r) => r.name === 'Culinary Workforce Grant')!;
    const hcf = rf.rows.find((r) => r.name === 'Youth Meals Grant')!;
    expect(mwsc.endingCents).toBe(2024709);
    expect(hcf.endingCents).toBe(361880);
    expect(rf.totals.endingCents).toBe(2386589);
    expect(rf.totals.checkCents).toBe(0);
    expect(hcf.released.direct + hcf.released.staff + hcf.released.overhead).toBe(2138120);
  });
});

describe('pilot grants (membership-tracked)', () => {
  let orgId: string;
  let salahId: string;
  let opioidId: string;
  const AS_OF = utcDate(2026, 9, 22);

  beforeAll(async () => {
    await resetDatabase();
    orgId = await createTestOrg();
    const summary = await seedPilot(orgId, PILOT_SEED);
    salahId = summary.grants.find((g) => g.key === 'salah')!.grantId;
    opioidId = summary.grants.find((g) => g.key === 'opioid')!.grantId;
    const r = await recompute(orgId);
    expect(r.status, r.error).toBe('succeeded');
  }, 300_000);

  it('both pilot grants are membership-tracked with their QuickBooks class / project', async () => {
    expect(await grantTracking(orgId, salahId)).toEqual({
      mode: 'membership',
      label: 'Tracked by QuickBooks class: Trauma Grants',
    });
    expect(await grantTracking(orgId, opioidId)).toEqual({
      mode: 'membership',
      label: 'Tracked by QuickBooks project: 2025-2026 Opioid Grant',
    });
    const stored = await prisma.grant.findMany({
      where: { id: { in: [salahId, opioidId] } },
      select: { trackingMode: true },
    });
    // Seeded directly (not through the grant form) — the mode is derived on read.
    expect(stored.map((g) => g.trackingMode)).toEqual(['crosswalk', 'crosswalk']);
  });

  it('Opioid: award 20,000, received 20,000, spent 16,286.10, balance 3,713.90 — same as the header and tree', async () => {
    const g = (await grantFiguresFor(orgId, opioidId, AS_OF))!;
    expect(g.figures.awardCents).toBe(2000000);
    expect(g.figures.receivedCents).toBe(2000000);
    expect(g.figures.spentCents).toBe(1628610);
    expect(g.figures.restrictedBalanceCents).toBe(371390);
    expect(
      g.figures.releasedByClass.direct +
        g.figures.releasedByClass.staff +
        g.figures.releasedByClass.overhead,
    ).toBe(1628610);
    expect(g.figures.needsReviewCents).toBe(0);
    const header = await headerMetrics(orgId, (await grantHeader(orgId, opioidId))!, AS_OF);
    expect(header.spentCents).toBe(1628610);
    expect(header.restrictedBalanceCents).toBe(371390);
    const tree = await budgetTree(orgId, opioidId, AS_OF);
    expect(tree.totals.chargedCents).toBe(1628610);
    expect(tree.totals.budgetCents).toBe(tree.totals.funderCents);
    const effort = await effortSummary(orgId, opioidId);
    expect(effort.totalChargedCents).toBe(1628610);
  });

  it('Opioid FY2026 rollforward still opens at 14,047.00 and closes at 3,713.90', async () => {
    const rf = await grantRollforward(orgId, opioidId, utcDate(2026, 1, 1), AS_OF);
    expect(rf.beginningCents).toBe(1404700);
    expect(rf.released.direct).toBe(510654);
    expect(rf.released.staff).toBe(522656);
    expect(rf.endingCents).toBe(371390);
  });

  it('Salah before D1: received 50,000; 21,520.40 released with 1,188.41 waiting; balance 28,479.60 on every page', async () => {
    const g = (await grantFiguresFor(orgId, salahId, AS_OF))!;
    expect(g.figures.receivedCents).toBe(5000000);
    expect(g.figures.releasedByClass).toEqual({ direct: 2152040, staff: 0, overhead: 0 });
    expect(g.figures.spentCents).toBe(2152040);
    expect(g.figures.needsReviewCents).toBe(118841);
    expect(g.figures.restrictedBalanceCents).toBe(2847960);
    const rf = await grantRollforward(orgId, salahId, utcDate(2026, 1, 1), AS_OF);
    expect(rf.endingCents).toBe(2847960);
    expect(rf.receivedCents).toBe(5000000);
    const header = await headerMetrics(orgId, (await grantHeader(orgId, salahId))!, AS_OF);
    expect(header.restrictedBalanceCents).toBe(2847960);
    const bva = (await bvaData(orgId, AS_OF, salahId)).grants[0]!;
    expect(bva.actual).toBe(2152040);
    expect(bva.balance).toBe(2847960);
  });
});
