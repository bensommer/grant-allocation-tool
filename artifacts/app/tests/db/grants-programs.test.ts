import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '@/lib/db';
import { createProgram, updateProgram, ValidationError } from '@/services/programs';
import { createGrant, saveBudgetLines, updateGrant, upsertBudgetLine } from '@/services/grants';
import { createTestOrg, resetDatabase } from './helpers';

const program = (code: string, classes: string[] = []) => ({
  code,
  name: code,
  description: null,
  functionalCategory: 'program' as const,
  matchClassIds: classes,
  active: true,
});
const grant = {
  name: 'G',
  funder: 'F',
  funderPartyId: null,
  awardNumber: null,
  startDate: new Date('2026-01-01'),
  endDate: new Date('2026-12-31'),
  awardAmountCents: 1_000_000,
  restrictionType: 'purpose' as const,
  status: 'active' as const,
  revenueAccountId: null,
  matchPartyIds: [],
  matchClassIds: [],
  programs: [],
};

describe('programs & grants services (JPH-8)', () => {
  let orgId: string;
  beforeEach(async () => {
    await resetDatabase();
    orgId = await createTestOrg();
  });
  afterAll(() => prisma.$disconnect());

  it('rejects duplicate program codes and classes already mapped to another program', async () => {
    const batch = await prisma.importBatch.create({
      data: { orgId, sourceSystem: 'csv', status: 'succeeded' },
    });
    const cls = await prisma.trackingClass.create({
      data: {
        orgId,
        sourceSystem: 'csv',
        externalId: 'C1',
        importBatchId: batch.id,
        name: 'Class 1',
      },
    });
    await createProgram(orgId, program('CT', [cls.id]));
    await expect(createProgram(orgId, program('CT'))).rejects.toMatchObject({
      fieldErrors: { code: expect.stringContaining('already exists') },
    });
    await expect(createProgram(orgId, program('YM', [cls.id]))).rejects.toBeInstanceOf(
      ValidationError,
    );
    const ym = await createProgram(orgId, program('YM'));
    await expect(updateProgram(orgId, ym.id, program('YM', [cls.id]))).rejects.toMatchObject({
      fieldErrors: { matchClassIds: 'Class Class 1 is already the default for program CT' },
    });
  });

  it('editing the award amount writes an AuditEvent with before/after and marks the current run stale', async () => {
    const g = await createGrant(orgId, grant);
    const run = await prisma.computeRun.create({
      data: { orgId, status: 'succeeded', configHash: 'x', isCurrent: true },
    });
    await updateGrant(orgId, g.id, { ...grant, awardAmountCents: 1_200_000 });
    const ev = await prisma.auditEvent.findFirst({
      where: { orgId, entity: 'Grant', entityId: g.id, action: 'update' },
    });
    expect(ev).not.toBeNull();
    expect((ev!.before as { awardAmountCents: number }).awardAmountCents).toBe(1_000_000);
    expect((ev!.after as { awardAmountCents: number }).awardAmountCents).toBe(1_200_000);
    expect((await prisma.computeRun.findUniqueOrThrow({ where: { id: run.id } })).stale).toBe(true);
  });

  it('budget line codes are unique per grant and totals compare against the award', async () => {
    const g = await createGrant(orgId, grant);
    await upsertBudgetLine(orgId, g.id, {
      code: 'PERS',
      name: 'Personnel',
      budgetCents: 600_000,
      programId: null,
      sortOrder: 1,
    });
    await expect(
      upsertBudgetLine(orgId, g.id, {
        code: 'PERS',
        name: 'Again',
        budgetCents: 1,
        programId: null,
        sortOrder: 2,
      }),
    ).rejects.toMatchObject({ fieldErrors: { code: 'Code PERS is already used in this grant' } });
    const sum = await prisma.grantBudgetLine.aggregate({
      _sum: { budgetCents: true },
      where: { grantId: g.id },
    });
    expect(sum._sum.budgetCents).toBe(600_000);
  });

  it('a batch save commits every edited line or none of them (JPH-25 A9)', async () => {
    const g = await createGrant(orgId, grant);
    const line = (code: string, budgetCents: number, sortOrder: number) => ({
      code,
      name: code,
      budgetCents,
      programId: null,
      sortOrder,
    });
    const a = await upsertBudgetLine(orgId, g.id, line('PERS', 600_000, 1));
    const b = await upsertBudgetLine(orgId, g.id, line('TRAV', 100_000, 2));
    const c = await upsertBudgetLine(orgId, g.id, line('SUPP', 50_000, 3));
    const auditBefore = await prisma.auditEvent.count({ where: { entity: 'GrantBudgetLine' } });

    // Row 3 fails validation (duplicate code) after rows 1 and 2 would have been written.
    await expect(
      saveBudgetLines(orgId, g.id, [
        { lineId: a.id, input: line('PERS', 650_000, 1) },
        { lineId: b.id, input: line('TRAV', 120_000, 2) },
        { lineId: c.id, input: line('PERS', 50_000, 3) },
      ]),
    ).rejects.toMatchObject({
      lineId: c.id,
      fieldErrors: { code: 'Code PERS is entered twice' },
    });
    const untouched = await prisma.grantBudgetLine.findMany({
      where: { grantId: g.id },
      orderBy: { sortOrder: 'asc' },
    });
    expect(untouched.map((l) => l.budgetCents)).toEqual([600_000, 100_000, 50_000]);
    expect(await prisma.auditEvent.count({ where: { entity: 'GrantBudgetLine' } })).toBe(
      auditBefore,
    );

    // A row that only the service can reject (its code collides with a line outside the
    // batch) also rolls the earlier rows back.
    await expect(
      saveBudgetLines(orgId, g.id, [
        { lineId: a.id, input: line('PERS', 650_000, 1) },
        { lineId: b.id, input: line('SUPP', 120_000, 2) },
      ]),
    ).rejects.toMatchObject({
      lineId: b.id,
      fieldErrors: { code: 'Code SUPP is already used in this grant' },
    });
    const stillUntouched = await prisma.grantBudgetLine.findMany({
      where: { grantId: g.id },
      orderBy: { sortOrder: 'asc' },
    });
    expect(stillUntouched.map((l) => l.budgetCents)).toEqual([600_000, 100_000, 50_000]);
    expect(await prisma.auditEvent.count({ where: { entity: 'GrantBudgetLine' } })).toBe(
      auditBefore,
    );

    // A clean batch persists both edits with one audit event per changed row and skips the
    // unchanged one.
    const { saved } = await saveBudgetLines(orgId, g.id, [
      { lineId: a.id, input: line('PERS', 650_000, 1) },
      { lineId: b.id, input: line('TRAV', 120_000, 2) },
      { lineId: c.id, input: line('SUPP', 50_000, 3) },
    ]);
    expect(saved).toBe(2);
    const after = await prisma.grantBudgetLine.findMany({
      where: { grantId: g.id },
      orderBy: { sortOrder: 'asc' },
    });
    expect(after.map((l) => l.budgetCents)).toEqual([650_000, 120_000, 50_000]);
    expect(await prisma.auditEvent.count({ where: { entity: 'GrantBudgetLine' } })).toBe(
      auditBefore + 2,
    );
  });
});
