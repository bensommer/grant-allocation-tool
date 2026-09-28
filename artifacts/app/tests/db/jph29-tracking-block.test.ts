/**
 * JPH-29 E3 — "How QuickBooks tracks this grant" must not lose memberships.
 *
 * The old edit form allowed member classes *and* member customers / projects on one grant.
 * The block shows one radio, so the list it does not show is carried through as hidden
 * fields; saving the form unchanged keeps both lists, the grant's transactions and its
 * spent figure. Only "Neither" clears them.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '@/lib/db';
import { trackingFieldsFromForm, trackingSelection } from '@/domain/tracking-choice';
import { createGrant, updateGrant, type GrantInput } from '@/services/grants';
import { readTrackingFields } from '@/app/grants/tracking-form';
import { createTestOrg, resetDatabase } from './helpers';

let orgId: string;
let classId: string;
let partyId: string;
let grantId: string;

const base: GrantInput = {
  name: 'Bridge grant',
  funder: 'Harbor Community Trust',
  funderPartyId: null,
  awardNumber: null,
  startDate: new Date('2026-01-01T00:00:00Z'),
  endDate: new Date('2026-12-31T00:00:00Z'),
  awardAmountCents: 10_000_00,
  restrictionType: 'purpose',
  status: 'active',
  revenueAccountId: null,
  matchPartyIds: [],
  matchClassIds: [],
  memberClassIds: [],
  memberPartyIds: [],
  qboClassName: null,
  qboProjectName: null,
  programs: [],
};

/** What the browser posts when the block is submitted as rendered. */
function formOf(sel: ReturnType<typeof trackingSelection>): FormData {
  const fd = new FormData();
  fd.set('trackingChoice', sel.choice);
  fd.set('trackingClass', sel.classValue);
  fd.set('trackingProject', sel.projectValue);
  fd.set('qboClassNameOverride', '');
  fd.set('qboProjectNameOverride', '');
  for (const id of sel.extraClassIds) fd.append('memberClassIds', id);
  for (const id of sel.extraPartyIds) fd.append('memberPartyIds', id);
  return fd;
}

beforeAll(async () => {
  await resetDatabase();
  orgId = await createTestOrg();
  const batch = await prisma.importBatch.create({
    data: { orgId, sourceSystem: 'csv', status: 'succeeded' },
  });
  const common = { orgId, sourceSystem: 'csv' as const, importBatchId: batch.id };
  classId = (
    await prisma.trackingClass.create({ data: { ...common, externalId: 'C1', name: 'Bridge' } })
  ).id;
  partyId = (
    await prisma.party.create({
      data: { ...common, externalId: 'P1', kind: 'customer', displayName: 'Bridge project' },
    })
  ).id;
  const account = await prisma.account.create({
    data: { ...common, externalId: 'A1', number: '6100', name: 'Supplies', type: 'Expense' },
  });
  // One transaction carries the class, another the customer: both belong to the grant.
  for (const [i, tag] of [{ classId }, { partyId }].entries()) {
    const txn = await prisma.transaction.create({
      data: {
        ...common,
        externalId: `T${i}`,
        txnType: 'Bill',
        txnDate: new Date('2026-03-15T00:00:00Z'),
        totalCents: 1_000 * (i + 1),
      },
    });
    await prisma.transactionLine.create({
      data: {
        orgId,
        transactionId: txn.id,
        lineNumber: 1,
        accountId: account.id,
        amountCents: 1_000 * (i + 1),
        postingType: 'debit',
        ...tag,
      },
    });
  }
  grantId = (
    await createGrant(orgId, { ...base, memberClassIds: [classId], memberPartyIds: [partyId] })
  ).id;
});
afterAll(() => prisma.$disconnect());

const memberships = () =>
  prisma.grantMembership.findMany({
    where: { grantId, supersededAt: null },
    select: { transactionLineId: true },
    orderBy: { transactionLineId: 'asc' },
  });

describe('a grant tracked by a class and a customer', () => {
  it('shows the class and carries the customer through', () => {
    const sel = trackingSelection({
      memberClassIds: [classId],
      memberPartyIds: [partyId],
      qboClassName: 'Bridge',
      qboProjectName: null,
    });
    expect(sel.choice).toBe('class');
    expect(sel.classValue).toBe(classId);
    expect(sel.extraPartyIds).toEqual([partyId]);
    const fields = trackingFieldsFromForm({
      choice: 'class',
      classValue: classId,
      projectValue: '',
      classOverride: '',
      projectOverride: '',
      extraClassIds: [],
      extraPartyIds: [partyId],
      classNameOf: () => 'Bridge',
      partyNameOf: () => null,
    });
    expect(fields.memberClassIds).toEqual([classId]);
    expect(fields.memberPartyIds).toEqual([partyId]);
  });

  it('saving the edit form unchanged keeps both lists, the memberships and the figures', async () => {
    const before = await prisma.grant.findUniqueOrThrow({ where: { id: grantId } });
    const membersBefore = await memberships();
    expect(membersBefore).toHaveLength(2);

    const sel = trackingSelection(before);
    const tracking = await readTrackingFields(orgId, formOf(sel));
    await updateGrant(orgId, grantId, { ...base, ...tracking });

    const after = await prisma.grant.findUniqueOrThrow({ where: { id: grantId } });
    expect(after.memberClassIds).toEqual([classId]);
    expect(after.memberPartyIds).toEqual([partyId]);
    expect(after.trackingMode).toBe(before.trackingMode);
    expect(await memberships()).toEqual(membersBefore);
    const spent = await prisma.transactionLine.aggregate({
      where: { memberships: { some: { grantId, supersededAt: null } } },
      _sum: { amountCents: true },
    });
    expect(spent._sum.amountCents).toBe(3_000);
  });

  it('the project radio keeps the classes the same way; only Neither clears them', async () => {
    const asProject = await readTrackingFields(
      orgId,
      formOf({
        ...trackingSelection({
          memberClassIds: [],
          memberPartyIds: [partyId],
          qboClassName: null,
          qboProjectName: null,
        }),
        extraClassIds: [classId],
      }),
    );
    expect(asProject.memberClassIds).toEqual([classId]);
    expect(asProject.memberPartyIds).toEqual([partyId]);

    const fd = formOf(
      trackingSelection(await prisma.grant.findUniqueOrThrow({ where: { id: grantId } })),
    );
    fd.set('trackingChoice', 'neither');
    const cleared = await readTrackingFields(orgId, fd);
    expect(cleared.memberClassIds).toEqual([]);
    expect(cleared.memberPartyIds).toEqual([]);
  });
});
