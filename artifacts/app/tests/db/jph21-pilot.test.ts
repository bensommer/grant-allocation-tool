import { readFileSync } from 'node:fs';
import path from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '@/lib/db';
import { runImport } from '@/datasource/import-service';
import { QboReportDataSource } from '@/datasource/qbo-report/adapter';
import { parseQboReport } from '@/datasource/qbo-report/parser';
import { readReportGrid } from '@/datasource/qbo-report/read';
import { lineMatches, normalizeText, parseMatchers } from '@/domain/matchers';
import { assertGrantStatesBalanced } from '@/domain/invariants';
import { REVIEW_REASONS, assignGrantLines, type GrantLineDraft } from '@/engine/grant-stage';
import { currentRun, recompute } from '@/engine/recompute';
import { budgetTree, type BudgetLineView } from '@/services/grant-budget';
import { REVERSAL_PAIR_REASON, recordDecision } from '@/services/line-decisions';
import { reviewQueue } from '@/services/review';
import { seedPilot } from '@/seed/pilot';
import { createTestOrg, resetDatabase } from './helpers';

/**
 * JPH-21 acceptance criteria against the anonymized pilot seed.
 * Every figure below comes from JPH-19 / JPH-21; never adjust one here.
 * The tests run in order: later criteria build on the decisions earlier ones record.
 */
const pilot = path.resolve(__dirname, '../../fixtures/pilot');
const SEED = path.join(pilot, 'seed.json');
const SALAH_EXPORT = 'salah-export.csv';
const ORG = { companyName: 'Test Org', fiscalYearStartMonth: 1, currency: 'USD' };

/** Appendix 3 Tier 1 — Salah working-line spend, in cents. */
const SALAH_SPENT: Record<string, number> = {
  KIRA: 519_264,
  PRACT: 710_000,
  TRAIN: 146_298,
  FOOD: 92_962,
  LEAH: 90_706,
  DANA: 27_500,
  CULSTAFF: 16_000,
  SUPP: 549_310,
};

/** Appendix 2 Tier 1 — Opioid direct grid, in cents (null = "—"). */
const OPIOID_GRID: Array<[string, Record<string, number | null>]> = [
  ['Sober Socials', { practitioners: 40_000, food: 51_875, supplies: null }],
  ["Daytime Mother's", { practitioners: 300_000, food: 19_824, supplies: null }],
  ['Conference', { practitioners: 100_000, food: 16_796, supplies: null }],
  ['Teen Monthly', { practitioners: 10_000, food: 103_998, supplies: 4_872 }],
  ["Mother's Exhaustion (virtual)", { practitioners: 60_000, food: null, supplies: 15_289 }],
];
const OPIOID_DIRECT_TOTAL = 722_654;
const OPIOID_PROGRAM_SUPPORT = { 'Sober Socials': 18_744, 'Teen Monthly': 49_609 };

const PRE_SEPT_LEAH_COUNT = 7;
const PRE_SEPT_LEAH_CENTS = 118_841;
const PAIR_113_96 = 11_396;
const PAIR_100_00 = 10_000;

let orgId: string;
let salahId: string;
let opioidId: string;

const spentByCode = async (grantId: string) => {
  const tree = await budgetTree(orgId, grantId);
  return { tree, spent: new Map(tree.all.map((l) => [l.code, l.spentCents])) };
};
const byName = <T extends { name: string }>(items: T[], name: string): T => {
  const found = items.find((i) => i.name === name);
  if (!found) throw new Error(`missing ${name}`);
  return found;
};
const cellOf = (tree: Awaited<ReturnType<typeof budgetTree>>, activity: string, key: string) => {
  const a = byName(tree.activities, activity);
  return tree.all.find((l) => l.kind === 'cell' && l.activityId === a.id && l.categoryKey === key);
};
const needsReview = (q: Awaited<ReturnType<typeof reviewQueue>>) =>
  q.groups.flatMap((g) => g.lines.map((l) => ({ ...l, reason: g.reason })));
const sum = (xs: Array<{ amountCents: number }>) => xs.reduce((s, x) => s + x.amountCents, 0);
const findPair = (q: Awaited<ReturnType<typeof reviewQueue>>, cents: number) =>
  q.proposals.find((p) => p.amountCents === cents);

async function succeedRecompute() {
  const r = await recompute(orgId);
  expect(r.status, r.error).toBe('succeeded');
  return r;
}

async function confirmPair(grantId: string, cents: number) {
  const q = await reviewQueue(orgId, grantId);
  const pair = findPair(q, cents);
  expect(pair, `proposal ±${cents}`).toBeDefined();
  await recordDecision(orgId, grantId, {
    kind: 'reversal_pair',
    lineIds: [pair!.positive.id, pair!.negative.id],
    targetBudgetLineId: null,
    reason: null,
    note: `confirmed ±${(cents / 100).toFixed(2)} pair`,
  });
  await succeedRecompute();
  return pair!;
}

async function reimportSalah() {
  const file = path.join(pilot, SALAH_EXPORT);
  const grid = await readReportGrid(readFileSync(file), SALAH_EXPORT);
  const report = parseQboReport(grid.rows, { fileName: SALAH_EXPORT });
  if (!report.dateRange) throw new Error('no date range');
  const source = new QboReportDataSource({
    report,
    fileName: SALAH_EXPORT,
    sha256: 'test',
    org: ORG,
  });
  return runImport(orgId, source, report.dateRange, {
    scope: { grantId: salahId, dateFrom: report.dateRange.from, dateTo: report.dateRange.to },
  });
}

/** Per-line state snapshot of the current run for one grant, keyed by fingerprint. */
async function stateSnapshot(grantId: string) {
  const run = await currentRun(orgId);
  const rows = await prisma.grantLineResult.findMany({
    where: { computeRunId: run!.id, grantId },
    include: { line: { select: { transaction: { select: { externalId: true } } } } },
  });
  return new Map(
    rows.map((r) => [
      r.line.transaction.externalId,
      `${r.state}|${r.budgetLineId ?? ''}|${r.reason ?? ''}`,
    ]),
  );
}

describe('JPH-21 budget model, grant rules and review queue (pilot seed)', () => {
  beforeAll(async () => {
    await resetDatabase();
    orgId = await createTestOrg();
    const summary = await seedPilot(orgId, SEED);
    salahId = summary.grants.find((g) => g.key === 'salah')!.grantId;
    opioidId = summary.grants.find((g) => g.key === 'opioid')!.grantId;
    expect(summary.grants.every((g) => g.imported)).toBe(true);
    await succeedRecompute();
  }, 300_000);

  it('AC1: after seed:pilot only the 7 pre-September Leah lines and the ±113.96 pair need review; confirming the pair leaves the 7 (1,188.41, "no rule match")', async () => {
    const before = await reviewQueue(orgId, salahId);
    const pending = needsReview(before);
    expect(pending).toHaveLength(PRE_SEPT_LEAH_COUNT + 2);
    expect(sum(pending)).toBe(PRE_SEPT_LEAH_CENTS);
    expect(before.counts.needsReview).toBe(PRE_SEPT_LEAH_COUNT + 2);
    const pair = findPair(before, PAIR_113_96);
    expect(pair).toBeDefined();
    expect(pair!.positive.state).toBe('needs_review');
    expect(pair!.negative.state).toBe('needs_review');
    expect(pair!.positive.amountCents + pair!.negative.amountCents).toBe(0);
    // Everything else is assigned or excluded.
    expect(before.counts.assigned + before.counts.excluded + before.counts.needsReview).toBe(
      before.assigned.length + before.excluded.length + pending.length,
    );

    await confirmPair(salahId, PAIR_113_96);

    const after = await reviewQueue(orgId, salahId);
    const remaining = needsReview(after);
    expect(remaining).toHaveLength(PRE_SEPT_LEAH_COUNT);
    expect(sum(remaining)).toBe(PRE_SEPT_LEAH_CENTS);
    expect(after.totals.needsReviewCents).toBe(PRE_SEPT_LEAH_CENTS);
    expect(new Set(remaining.map((l) => l.reason))).toEqual(new Set([REVIEW_REASONS.noRule]));
    expect(remaining.every((l) => l.txnDate < new Date('2026-09-01T00:00:00Z'))).toBe(true);
    expect(findPair(after, PAIR_113_96)).toBeUndefined();
  });

  it('AC2: Salah working-line spent matches Appendix 3 Tier 1 exactly', async () => {
    const { spent } = await spentByCode(salahId);
    for (const [code, cents] of Object.entries(SALAH_SPENT)) {
      expect(spent.get(code), code).toBe(cents);
    }
  });

  it('AC3: both reversal pairs are proposed; confirmed pairs are excluded with reason "reversal pair" and Practitioners stays at 7,100.00', async () => {
    // The ±113.96 pair was confirmed in AC1; the ±100.00 re-cut pair is still a proposal.
    const q = await reviewQueue(orgId, salahId);
    const recut = findPair(q, PAIR_100_00);
    expect(recut).toBeDefined();
    const practId = (await spentByCode(salahId)).tree.all.find((l) => l.code === 'PRACT')!.id;
    expect(recut!.positive.state).toBe('assigned');
    expect(recut!.negative.state).toBe('assigned');
    expect(recut!.positive.budgetLineId).toBe(practId);
    expect(recut!.negative.budgetLineId).toBe(practId);
    const confirmedIds = new Set(
      q.excluded.filter((l) => l.reason === REVERSAL_PAIR_REASON).map((l) => l.id),
    );
    expect(confirmedIds.size).toBe(2);

    await confirmPair(salahId, PAIR_100_00);

    const after = await reviewQueue(orgId, salahId);
    const excludedPairs = after.excluded.filter((l) => l.reason === REVERSAL_PAIR_REASON);
    expect(excludedPairs).toHaveLength(4);
    expect(sum(excludedPairs)).toBe(0);
    expect(excludedPairs.map((l) => Math.abs(l.amountCents)).sort((a, b) => a - b)).toEqual([
      PAIR_100_00,
      PAIR_100_00,
      PAIR_113_96,
      PAIR_113_96,
    ]);
    expect(after.proposals.some((p) => p.amountCents === PAIR_100_00)).toBe(false);
    expect((await spentByCode(salahId)).spent.get('PRACT')).toBe(SALAH_SPENT.PRACT);
  });

  it('AC4: the Opioid direct grid matches Appendix 2 Tier 1 and Program Support matches Sober Socials 187.44 / Teen 496.09', async () => {
    const { tree } = await spentByCode(opioidId);
    let direct = 0;
    for (const [activity, cells] of OPIOID_GRID) {
      for (const [key, cents] of Object.entries(cells)) {
        const cell = cellOf(tree, activity, key);
        expect(cell, `${activity} / ${key}`).toBeDefined();
        expect(cell!.spentCents, `${activity} / ${key}`).toBe(cents ?? 0);
        direct += cell!.spentCents;
      }
    }
    expect(direct).toBe(OPIOID_DIRECT_TOTAL);
    for (const [activity, cents] of Object.entries(OPIOID_PROGRAM_SUPPORT)) {
      expect(cellOf(tree, activity, 'program_support')!.spentCents, activity).toBe(cents);
    }
    // The only Opioid lines left for review are the two halves of a proposed reversal
    // pair (an expense and the journal entry that reverses it), which net to zero.
    const q = await reviewQueue(orgId, opioidId);
    const pending = needsReview(q);
    expect(sum(pending)).toBe(0);
    expect(
      q.proposals
        .map((p) => [p.positive.id, p.negative.id].sort())
        .flat()
        .sort(),
    ).toEqual(pending.map((l) => l.id).sort());
    const otherActivityCents = tree.all
      .filter(
        (l) =>
          l.kind === 'cell' &&
          !['practitioners', 'food', 'supplies', 'program_support'].includes(l.categoryKey ?? ''),
      )
      .reduce((s, l) => s + l.spentCents, 0);
    expect(otherActivityCents).toBe(0);
  });

  it('AC6: keyword matching ignores case, apostrophes and repeated spaces', () => {
    const variants = ["Carroll's Light", 'Carrolls Light', 'CARROLLS  LIGHT'];
    expect(new Set(variants.map(normalizeText)).size).toBe(1);
    const m = parseMatchers({ descriptionContainsAny: ["carroll's light"] });
    const line = (description: string) => ({
      accountId: 'a',
      accountNumber: null,
      classId: null,
      locationId: null,
      partyId: null,
      txnPartyId: null,
      description,
      memo: null,
      txnDate: new Date('2026-01-01T00:00:00Z'),
      programId: null,
    });
    for (const v of variants) expect(lineMatches(line(`Snacks for ${v} session`), m), v).toBe(true);
    expect(lineMatches(line('Carroll Lighting Co invoice'), m)).toBe(false);
  });

  it('AC9: the Salah funder view sums its working lines, the 1,400 revision is in history and the 0.61 gap surfaces as a warning', async () => {
    const { tree } = await spentByCode(salahId);
    expect(tree.categories.length).toBeGreaterThan(0);
    for (const cat of tree.categories) {
      const childSpent = cat.children.reduce((s: number, c: BudgetLineView) => s + c.spentCents, 0);
      const childCurrent = cat.children.reduce(
        (s: number, c: BudgetLineView) => s + c.currentCents,
        0,
      );
      expect(cat.spentCents, `${cat.code} spent`).toBe(childSpent);
      expect(cat.childrenCurrentCents, `${cat.code} current`).toBe(childCurrent);
    }
    const revision = tree.revisions.find((r) => r.deltaCents === 140_000);
    expect(revision).toBeDefined();
    expect(revision!.budgetLineCode).toBe('PRACT');
    expect(revision!.counterpartCode).toBe('TRAIN');
    const pract = tree.all.find((l) => l.code === 'PRACT')!;
    expect(pract.currentCents).toBe(pract.originalCents + 140_000);
    const train = tree.all.find((l) => l.code === 'TRAIN')!;
    expect(train.currentCents).toBe(train.originalCents - 140_000);
    expect(tree.totals.funderCents).toBe(5_000_000);
    expect(tree.totals.workingCurrentCents).toBe(5_000_061);
    expect(tree.totals.workingCurrentCents - tree.totals.funderCents).toBe(61);
  });

  it('AC5: with the ±113.96 pair confirmed, D1-A gives Leah 2,095.47 / Culinary Staff 2,530.47, D1-B gives 907.06 / 1,342.06, and both empty the queue', async () => {
    const q = await reviewQueue(orgId, salahId);
    const pending = needsReview(q);
    expect(pending).toHaveLength(PRE_SEPT_LEAH_COUNT);
    const { tree } = await spentByCode(salahId);
    const leah = tree.all.find((l) => l.code === 'LEAH')!;
    const culinary = tree.categories.find((c) => c.code === 'CULINARY')!;

    // D1-A: assign the seven lines to Leah.
    await recordDecision(orgId, salahId, {
      kind: 'assign',
      lineIds: pending.map((l) => l.id),
      targetBudgetLineId: leah.id,
      reason: null,
      note: 'D1-A: pre-September Leah payroll counts toward the grant',
    });
    await succeedRecompute();
    let now = await spentByCode(salahId);
    expect(now.spent.get('LEAH')).toBe(209_547);
    expect(now.tree.categories.find((c) => c.id === culinary.id)!.spentCents).toBe(253_047);
    expect((await reviewQueue(orgId, salahId)).counts.needsReview).toBe(0);

    // D1-B: exclude them as not allowable (supersedes D1-A).
    await recordDecision(orgId, salahId, {
      kind: 'exclude',
      lineIds: pending.map((l) => l.id),
      targetBudgetLineId: null,
      reason: 'not allowable',
      note: 'D1-B: pre-September payroll is outside the award period',
    });
    await succeedRecompute();
    now = await spentByCode(salahId);
    expect(now.spent.get('LEAH')).toBe(90_706);
    expect(now.tree.categories.find((c) => c.id === culinary.id)!.spentCents).toBe(134_206);
    const after = await reviewQueue(orgId, salahId);
    expect(after.counts.needsReview).toBe(0);
    expect(after.excluded.filter((l) => l.reason === 'not allowable')).toHaveLength(
      PRE_SEPT_LEAH_COUNT,
    );
    // Decisions are superseded, never deleted.
    expect(
      await prisma.lineDecision.count({
        where: { grantId: salahId, kind: 'assign', supersededAt: { not: null } },
      }),
    ).toBe(PRE_SEPT_LEAH_COUNT);
  });

  it('AC7: decisions and manual assignments survive re-importing the same export', async () => {
    const before = await stateSnapshot(salahId);
    const decisionsBefore = await prisma.lineDecision.count({
      where: { grantId: salahId, supersededAt: null },
    });
    const je = await prisma.transactionLine.findFirst({
      where: {
        orgId,
        transaction: { docNumber: '19-64' },
        memberships: { some: { grantId: salahId } },
      },
      include: { transaction: true },
    });
    expect(je).not.toBeNull();

    const again = await reimportSalah();
    expect(again.status).toBe('succeeded');
    expect(again.counts.transactions).toMatchObject({ new: 0, changed: 0, deleted: 0 });
    await succeedRecompute();

    const after = await stateSnapshot(salahId);
    expect(after.size).toBe(before.size);
    const sorted = (m: Map<string, string>) =>
      [...m.entries()].sort(([a], [b]) => a.localeCompare(b));
    expect(sorted(after)).toEqual(sorted(before));
    expect(
      await prisma.lineDecision.count({ where: { grantId: salahId, supersededAt: null } }),
    ).toBe(decisionsBefore);
    const { spent, tree } = await spentByCode(salahId);
    for (const [code, cents] of Object.entries(SALAH_SPENT))
      expect(spent.get(code), code).toBe(cents);
    // The manual JE 19-64 assignment still lands on Practitioners.
    const practId = tree.all.find((l) => l.code === 'PRACT')!.id;
    expect(after.get(je!.transaction.externalId)).toBe(`assigned|${practId}|`);
    const q = await reviewQueue(orgId, salahId);
    expect(q.excluded.filter((l) => l.reason === REVERSAL_PAIR_REASON)).toHaveLength(4);
    expect(q.counts.needsReview).toBe(0);
  });

  it('AC8: the state invariant holds for both grants, and a line that is both assigned and unassigned fails the compute run', async () => {
    const run = await currentRun(orgId);
    expect(run).not.toBeNull();
    await expect(assertGrantStatesBalanced(run!.id)).resolves.toMatchObject({ grants: 2 });
    for (const grantId of [salahId, opioidId]) {
      const q = await reviewQueue(orgId, grantId);
      expect(q.totals.assignedCents + q.totals.excludedCents + q.totals.needsReviewCents).toBe(
        q.totals.memberCents,
      );
    }

    const broken = await recompute(orgId, {
      grantStage: (lines, config) => {
        const drafts = assignGrantLines(lines, config);
        const first = drafts.find((d) => d.grantId === salahId && d.state === 'assigned')!;
        const duplicate: GrantLineDraft = {
          ...first,
          state: 'needs_review',
          budgetLineId: null,
          reason: REVIEW_REASONS.noRule,
        };
        return [...drafts, duplicate];
      },
    });
    expect(broken.status).toBe('failed');
    expect(broken.error).toMatch(/grant line state imbalance/i);
    const failed = await prisma.computeRun.findUnique({ where: { id: broken.runId } });
    expect(failed?.status).toBe('failed');
    expect(failed?.isCurrent).toBe(false);
    expect((await currentRun(orgId))?.id).toBe(run!.id);
  });
});
