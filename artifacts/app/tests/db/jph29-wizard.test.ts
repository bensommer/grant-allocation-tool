/**
 * JPH-29 E4 — the setup wizard's Finish and the step inputs it depends on.
 *
 * - Step 2's Grant income selections (funder customers, income classes) reach the grant.
 * - Codes are checked against the persisted budget line schema at step 3 / 4, not at Finish.
 * - Finish is one transaction: a failure part-way leaves no grant, lines or rules behind.
 * - The Funder view export carries the category rows only (no working lines under them).
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '@/lib/db';
import { utcDate } from '@/domain/dates';
import {
  BUDGET_CODE_PATTERN,
  emptyDraft,
  incomeSelections,
  parseBudget,
  parseLines,
  type StepValues,
} from '@/domain/grant-draft';
import { funderCategoriesTable, funderViewTable } from '@/reports/funder-view';
import { budgetTree } from '@/services/grant-budget';
import { finishDraft, saveStep, type Draft } from '@/services/grant-draft';
import { createTestOrg, resetDatabase } from './helpers';

let orgId: string;
let funderId: string;
let otherCustomerId: string;
let classId: string;

const AWARD: StepValues = {
  name: 'Harbor Youth Kitchen — Bridge Grant',
  funderText: 'Harbor Community Trust',
  awardNumber: 'HCT-26-04',
  awardAmount: '120,000.00',
  startDate: '2026-01-01',
  endDate: '2026-12-31',
  restrictionType: 'purpose',
};
const BUDGET: StepValues = {
  catCode: ['INSTR', 'FOOD'],
  catName: ['Instructors', 'Food'],
  catAmount: ['70,000', '50,000'],
};
const LINES: StepValues = {
  hasLines: 'yes',
  lineCat: ['0', '0', '1'],
  lineCode: ['LEAD', 'ASSIST', 'MEALS'],
  lineName: ['Lead instructor', 'Assistant', 'Meals'],
  lineAmount: ['50,000', '20,000', '50,000'],
};
const TRACKING = {
  memberClassIds: [] as string[],
  memberPartyIds: [] as string[],
  qboClassName: 'Bridge Grant',
  qboProjectName: null,
};

async function newDraft(): Promise<Draft> {
  const row = await prisma.grantDraft.create({
    data: { orgId, token: `t-${Math.random().toString(36).slice(2)}`, data: emptyDraft() },
  });
  return { id: row.id, orgId, token: row.token, step: 1, data: emptyDraft() };
}

async function completeDraft(step2: StepValues): Promise<Draft> {
  let d = await newDraft();
  d = await saveStep(d, 1, AWARD, { resumeAt: 2 });
  d = await saveStep(d, 2, step2, { resumeAt: 3, tracking: TRACKING });
  d = await saveStep(d, 3, BUDGET, { resumeAt: 4 });
  d = await saveStep(d, 4, LINES, { resumeAt: 5 });
  return d;
}

beforeAll(async () => {
  await resetDatabase();
  orgId = await createTestOrg();
  const batch = await prisma.importBatch.create({
    data: { orgId, sourceSystem: 'csv', status: 'succeeded' },
  });
  const party = (externalId: string, displayName: string) =>
    prisma.party.create({
      data: {
        orgId,
        sourceSystem: 'csv',
        externalId,
        importBatchId: batch.id,
        kind: 'customer',
        displayName,
      },
    });
  funderId = (await party('P1', 'Harbor Community Trust')).id;
  otherCustomerId = (await party('P2', 'City of Bayport')).id;
  classId = (
    await prisma.trackingClass.create({
      data: {
        orgId,
        sourceSystem: 'csv',
        externalId: 'C1',
        importBatchId: batch.id,
        name: 'Grant income',
      },
    })
  ).id;
});
afterAll(() => prisma.$disconnect());

describe('step 2 — grant income', () => {
  it('defaults to the funder customer until the block is posted, then keeps the selection', () => {
    expect(incomeSelections({}, 'p1')).toEqual({ matchPartyIds: ['p1'], matchClassIds: [] });
    expect(incomeSelections({ incomePosted: '1' }, 'p1')).toEqual({
      matchPartyIds: [],
      matchClassIds: [],
    });
    expect(
      incomeSelections(
        { incomePosted: '1', matchPartyIds: ['p2', 'p2'], matchClassIds: 'c1' },
        'p1',
      ),
    ).toEqual({ matchPartyIds: ['p2'], matchClassIds: ['c1'] });
  });

  it('Finish writes the selected customers and income classes to the grant', async () => {
    const draft = await completeDraft({
      incomePosted: '1',
      matchPartyIds: [funderId, otherCustomerId],
      matchClassIds: [classId],
    });
    const grantId = await finishDraft(orgId, draft, [], {});
    const grant = await prisma.grant.findUniqueOrThrow({ where: { id: grantId } });
    expect(grant.matchPartyIds.sort()).toEqual([funderId, otherCustomerId].sort());
    expect(grant.matchClassIds).toEqual([classId]);
    expect(grant.funderPartyId).toBe(funderId);
    expect(grant.qboClassName).toBe('Bridge Grant');
    await expect(prisma.grantDraft.findUnique({ where: { id: draft.id } })).resolves.toBeNull();
    await prisma.grant.delete({ where: { id: grantId } });
  });

  it('a cleared selection stays cleared; an unposted block falls back to the funder', async () => {
    const cleared = await finishDraft(orgId, await completeDraft({ incomePosted: '1' }), [], {});
    const unposted = await finishDraft(
      orgId,
      await saveStep(await completeDraft({}), 1, { ...AWARD, name: 'Second grant' }),
      [],
      {},
    );
    const [a, b] = await Promise.all([
      prisma.grant.findUniqueOrThrow({ where: { id: cleared } }),
      prisma.grant.findUniqueOrThrow({ where: { id: unposted } }),
    ]);
    expect(a.matchPartyIds).toEqual([]);
    expect(b.matchPartyIds).toEqual([funderId]);
    await prisma.grant.deleteMany({ where: { id: { in: [cleared, unposted] } } });
  });
});

describe('steps 3 / 4 — codes match the persisted budget line schema', () => {
  it('rejects a code the budget line schema would reject, on the step that owns it', () => {
    const bad = parseBudget({ ...BUDGET, catCode: ['IN STR', 'FOOD'] });
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.errors['catCode_0']).toMatch(/letters, numbers/);
    const long = parseBudget({ ...BUDGET, catCode: ['X'.repeat(31), 'FOOD'] });
    expect(long.ok).toBe(false);
    const cats = parseBudget(BUDGET);
    expect(cats.ok).toBe(true);
    if (!cats.ok) return;
    const badLine = parseLines({ ...LINES, lineCode: ['LE/AD', 'ASSIST', 'MEALS'] }, cats.data);
    expect(badLine.ok).toBe(false);
    if (!badLine.ok) expect(badLine.errors['lineCode_0']).toMatch(/letters, numbers/);
  });

  it('generates codes that satisfy the schema from any name', () => {
    const r = parseBudget({
      catName: ['Facilitators & Trauma Informed', 'Food / Beverage (on-site)', 'Ünïcode — name'],
      catAmount: ['1', '2', '3'],
    });
    expect(r.ok).toBe(true);
    if (r.ok) for (const c of r.data) expect(c.code).toMatch(BUDGET_CODE_PATTERN);
  });
});

describe('Finish is one transaction', () => {
  it('a failure while writing the rules leaves no grant, lines or rules behind', async () => {
    const draft = await completeDraft({ incomePosted: '1', matchPartyIds: [funderId] });
    const bogus = {
      key: 'nope|',
      accountId: 'not-an-account',
      accountName: 'Bogus',
      partyId: null,
      partyName: null,
      count: 3,
      totalCents: 1_000,
      preselect: null,
      reason: 'test',
    };
    const before = await prisma.grant.count({ where: { orgId } });
    await expect(
      finishDraft(orgId, draft, [bogus], { 'rule_nope|': 'LEAD' }),
    ).rejects.toMatchObject({ name: 'ValidationError' });
    expect(await prisma.grant.count({ where: { orgId } })).toBe(before);
    expect(
      await prisma.grant.findFirst({ where: { orgId, name: String(AWARD['name']) } }),
    ).toBeNull();
    expect(await prisma.grantBudgetLine.count({ where: { orgId } })).toBe(0);
    expect(await prisma.crosswalkRule.count({ where: { orgId } })).toBe(0);
    // The draft survives, so Finish can be pressed again once the problem is fixed.
    await expect(prisma.grantDraft.findUnique({ where: { id: draft.id } })).resolves.not.toBeNull();
    const grantId = await finishDraft(orgId, draft, [], {});
    expect(await prisma.grantBudgetLine.count({ where: { grantId } })).toBe(5);
    await prisma.grant.delete({ where: { id: grantId } });
  });
});

describe('Funder view export', () => {
  it('carries the category rows only — the working lines beneath them are not exported', async () => {
    const draft = await completeDraft({ incomePosted: '1' });
    const grantId = await finishDraft(orgId, draft, [], {});
    const tree = await budgetTree(orgId, grantId, utcDate(2026, 6, 30));
    const header = { name: String(AWARD['name']), funder: 'Harbor Community Trust' };
    const full = funderViewTable(header, tree, utcDate(2026, 6, 30));
    const categories = funderCategoriesTable(header, tree, utcDate(2026, 6, 30));
    expect(full.rows.map((r) => String(r[0]).trim())).toEqual([
      'Instructors',
      'Lead instructor',
      'Assistant',
      'Food',
      'Meals',
    ]);
    expect(categories.rows.map((r) => r[0])).toEqual(['Instructors', 'Food']);
    expect(categories.rowKinds?.every((k) => k === 'group')).toBe(true);
    // Budget column sums to the totals row (no double counting).
    const sum = categories.rows.reduce((a, r) => a + Number(r[1]), 0);
    expect(sum).toBe(categories.totals![1]);
    expect(sum).toBe(12_000_000);
    await prisma.grant.delete({ where: { id: grantId } });
  });
});
