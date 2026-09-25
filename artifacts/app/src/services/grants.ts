import { z } from 'zod';
import { categoryKeyPattern } from '@/domain/categories';
import { prisma } from '@/lib/db';
import { recordAudit } from '@/lib/audit';
import { markCurrentRunStale } from '@/lib/stale';
import { MAX_CENTS } from '@/domain/money';
import { ValidationError } from '@/services/programs';
import { assertOrgRefs } from '@/services/refs';
import { syncRuleMemberships } from '@/services/grant-membership';

export const grantInputSchema = z
  .object({
    name: z.string().trim().min(1, 'Name is required').max(200),
    funder: z.string().trim().min(1, 'Funder is required').max(200),
    funderPartyId: z.string().nullable(),
    awardNumber: z.string().trim().max(100).nullable(),
    startDate: z.date(),
    endDate: z.date(),
    awardAmountCents: z.number().int().positive('Award must be greater than zero').max(MAX_CENTS),
    restrictionType: z.enum(['purpose', 'time', 'both', 'unrestricted']),
    status: z.enum(['draft', 'active', 'closed', 'archived']),
    revenueAccountId: z.string().nullable(),
    matchPartyIds: z.array(z.string()),
    matchClassIds: z.array(z.string()),
    /** Live-QuickBooks membership rules (JPH-20): classes / projects whose lines belong to this grant. */
    memberClassIds: z.array(z.string()).default([]),
    memberPartyIds: z.array(z.string()).default([]),
    programs: z.array(
      z.object({
        programId: z.string(),
        plannedShareBps: z.number().int().min(0).max(10000).nullable(),
      }),
    ),
  })
  .refine((g) => g.endDate >= g.startDate, {
    message: 'End date must be on or after start date',
    path: ['endDate'],
  });
export type GrantInput = z.input<typeof grantInputSchema>;
type ParsedGrantInput = z.output<typeof grantInputSchema>;

async function assertGrantRefs(orgId: string, input: ParsedGrantInput) {
  await assertOrgRefs(prisma, orgId, 'programs', {
    programIds: input.programs.map((p) => p.programId),
  });
  await assertOrgRefs(prisma, orgId, 'funderPartyId', {
    partyIds: input.funderPartyId ? [input.funderPartyId] : [],
  });
  await assertOrgRefs(prisma, orgId, 'matchPartyIds', { partyIds: input.matchPartyIds });
  await assertOrgRefs(prisma, orgId, 'matchClassIds', { classIds: input.matchClassIds });
  await assertOrgRefs(prisma, orgId, 'memberPartyIds', { partyIds: input.memberPartyIds });
  await assertOrgRefs(prisma, orgId, 'memberClassIds', { classIds: input.memberClassIds });
  await assertOrgRefs(prisma, orgId, 'revenueAccountId', {
    accountIds: input.revenueAccountId ? [input.revenueAccountId] : [],
  });
}

export async function createGrant(orgId: string, rawInput: GrantInput) {
  const input = grantInputSchema.parse(rawInput);
  const { programs, ...data } = input;
  await assertGrantRefs(orgId, input);
  return prisma.$transaction(async (tx) => {
    const g = await tx.grant.create({
      data: { orgId, ...data, programs: { create: programs } },
      include: { programs: true },
    });
    await recordAudit(tx, { orgId, entity: 'Grant', entityId: g.id, action: 'create', after: g });
    await syncRuleMemberships(tx, orgId, g.id);
    await markCurrentRunStale(tx, orgId);
    return g;
  });
}

export async function updateGrant(orgId: string, id: string, rawInput: GrantInput) {
  const input = grantInputSchema.parse(rawInput);
  const before = await prisma.grant.findFirst({
    where: { id, orgId },
    include: { programs: true },
  });
  if (!before) throw new ValidationError({ _: 'Grant not found' });
  const { programs, ...data } = input;
  await assertGrantRefs(orgId, input);
  return prisma.$transaction(async (tx) => {
    await tx.grantProgram.deleteMany({ where: { grantId: id } });
    const after = await tx.grant.update({
      where: { id },
      data: { ...data, programs: { create: programs } },
      include: { programs: true },
    });
    await recordAudit(tx, {
      orgId,
      entity: 'Grant',
      entityId: id,
      action: 'update',
      before,
      after,
    });
    await syncRuleMemberships(tx, orgId, id);
    await markCurrentRunStale(tx, orgId);
    return after;
  });
}

/** Hard delete only when no run, import or decision references the grant; otherwise archive. */
export async function deleteOrArchiveGrant(
  orgId: string,
  id: string,
): Promise<{ archived: boolean }> {
  const before = await prisma.grant.findFirst({
    where: { id, orgId },
    include: { programs: true, budgetLines: true },
  });
  if (!before) throw new ValidationError({ _: 'Grant not found' });
  const referenced =
    (await prisma.allocatedLine.count({
      where: { OR: [{ grantId: id }, { grantBudgetLine: { grantId: id } }] },
    })) +
    (await prisma.importBatch.count({ where: { scopeGrantId: id } })) +
    (await prisma.lineDecision.count({ where: { grantId: id } }));
  if (referenced > 0) {
    await prisma.$transaction(async (tx) => {
      const after = await tx.grant.update({ where: { id }, data: { status: 'archived' } });
      await recordAudit(tx, {
        orgId,
        entity: 'Grant',
        entityId: id,
        action: 'update',
        before,
        after,
      });
      await markCurrentRunStale(tx, orgId);
    });
    return { archived: true };
  }
  await prisma.$transaction(async (tx) => {
    await tx.grant.delete({ where: { id } });
    await recordAudit(tx, { orgId, entity: 'Grant', entityId: id, action: 'delete', before });
    await markCurrentRunStale(tx, orgId);
  });
  return { archived: false };
}

// --- budget lines -----------------------------------------------------------

export const budgetLineInputSchema = z.object({
  code: z
    .string()
    .trim()
    .min(1, 'Code is required')
    .max(30)
    .regex(/^[A-Za-z0-9_.-]+$/, 'Letters, numbers, dash, dot, underscore only'),
  name: z.string().trim().min(1, 'Name is required').max(200),
  budgetCents: z.number().int().min(0, 'Budget cannot be negative').max(MAX_CENTS),
  programId: z.string().nullable(),
  sortOrder: z.number().int().min(0).max(9999),
  /** JPH-21 two-level budget. Defaults keep flat (phase-1) budgets working unchanged. */
  kind: z.enum(['funder_category', 'working_line', 'cell']).default('working_line'),
  parentId: z.string().nullable().default(null),
  activityId: z.string().nullable().default(null),
  categoryKey: z
    .string()
    .regex(categoryKeyPattern, 'Category key: lower-case letters, digits, underscore')
    .nullable()
    .default(null),
});
export type BudgetLineInput = z.input<typeof budgetLineInputSchema>;

/** Structural rules for a two-level budget line, beyond the field shapes. */
async function assertBudgetLineShape(
  grantId: string,
  input: BudgetLineInput,
  id: string | undefined,
): Promise<void> {
  const errors: Record<string, string> = {};
  if (input.kind === 'funder_category') {
    if (input.parentId) errors['parentId'] = 'A funder category cannot have a parent';
    if (input.activityId || input.categoryKey)
      errors['activityId'] = 'Only cells carry an activity and category';
  } else {
    if (input.parentId) {
      const parent = await prisma.grantBudgetLine.findFirst({
        where: { id: input.parentId, grantId },
      });
      if (!parent) errors['parentId'] = 'Parent not found in this grant';
      else if (parent.kind !== 'funder_category')
        errors['parentId'] = 'Parent must be a funder category';
      else if (id && parent.id === id) errors['parentId'] = 'A line cannot be its own parent';
    }
    if (input.kind === 'cell') {
      if (!input.activityId || !input.categoryKey)
        errors['activityId'] = 'A cell needs both an activity and a category';
      else {
        const activity = await prisma.grantActivity.findFirst({
          where: { id: input.activityId, grantId },
        });
        if (!activity) errors['activityId'] = 'Activity not found in this grant';
        const dup = await prisma.grantBudgetLine.findFirst({
          where: {
            grantId,
            kind: 'cell',
            activityId: input.activityId,
            categoryKey: input.categoryKey,
            ...(id ? { id: { not: id } } : {}),
          },
        });
        if (dup) errors['categoryKey'] = `Cell ${dup.code} already covers this activity × category`;
      }
    } else if (input.activityId || input.categoryKey) {
      errors['activityId'] = 'Only cells carry an activity and category';
    }
  }
  if (Object.keys(errors).length > 0) throw new ValidationError(errors);
}

export async function upsertBudgetLine(
  orgId: string,
  grantId: string,
  rawInput: BudgetLineInput,
  id?: string,
) {
  const input = budgetLineInputSchema.parse(rawInput);
  const grant = await prisma.grant.findFirst({ where: { id: grantId, orgId } });
  if (!grant) throw new ValidationError({ _: 'Grant not found' });
  await assertOrgRefs(prisma, orgId, 'programId', {
    programIds: input.programId ? [input.programId] : [],
  });
  const dup = await prisma.grantBudgetLine.findFirst({
    where: { grantId, code: input.code, ...(id ? { id: { not: id } } : {}) },
  });
  if (dup) throw new ValidationError({ code: `Code ${input.code} is already used in this grant` });
  await assertBudgetLineShape(grantId, input, id);
  return prisma.$transaction(async (tx) => {
    if (id) {
      const before = await tx.grantBudgetLine.findFirstOrThrow({ where: { id, grantId } });
      if (before.kind === 'funder_category' && input.kind !== 'funder_category') {
        const children = await tx.grantBudgetLine.count({ where: { parentId: id } });
        if (children > 0)
          throw new ValidationError({ kind: 'Move its lines out before changing the kind' });
      }
      const after = await tx.grantBudgetLine.update({ where: { id }, data: input });
      await recordAudit(tx, {
        orgId,
        entity: 'GrantBudgetLine',
        entityId: id,
        action: 'update',
        before,
        after,
      });
      await markCurrentRunStale(tx, orgId);
      return after;
    }
    const created = await tx.grantBudgetLine.create({ data: { orgId, grantId, ...input } });
    await recordAudit(tx, {
      orgId,
      entity: 'GrantBudgetLine',
      entityId: created.id,
      action: 'create',
      after: created,
    });
    await markCurrentRunStale(tx, orgId);
    return created;
  });
}

export async function deleteBudgetLine(orgId: string, grantId: string, id: string) {
  const before = await prisma.grantBudgetLine.findFirst({ where: { id, grantId, orgId } });
  if (!before) throw new ValidationError({ _: 'Budget line not found' });
  const referenced = await prisma.allocatedLine.count({ where: { grantBudgetLineId: id } });
  if (referenced > 0) {
    throw new ValidationError({
      _: `Budget line ${before.code} is used by a compute run. Recompute after removing its crosswalk rules first.`,
    });
  }
  await prisma.$transaction(async (tx) => {
    await tx.grantBudgetLine.delete({ where: { id } });
    await recordAudit(tx, {
      orgId,
      entity: 'GrantBudgetLine',
      entityId: id,
      action: 'delete',
      before,
    });
    await markCurrentRunStale(tx, orgId);
  });
}

/** Bulk import: rows already parsed + validated by the caller. Upserts by code. */
export async function importBudgetLines(
  orgId: string,
  grantId: string,
  rawRows: BudgetLineInput[],
) {
  const rows = rawRows.map((r) => budgetLineInputSchema.parse(r));
  await assertOrgRefs(prisma, orgId, '_', { grantIds: [grantId] });
  await assertOrgRefs(prisma, orgId, 'programId', {
    programIds: rows.flatMap((r) => (r.programId ? [r.programId] : [])),
  });
  return prisma.$transaction(async (tx) => {
    let created = 0;
    let updated = 0;
    for (const r of rows) {
      const existing = await tx.grantBudgetLine.findFirst({
        where: { orgId, grantId, code: r.code },
      });
      if (existing) {
        const after = await tx.grantBudgetLine.update({ where: { id: existing.id }, data: r });
        await recordAudit(tx, {
          orgId,
          entity: 'GrantBudgetLine',
          entityId: existing.id,
          action: 'update',
          before: existing,
          after,
        });
        updated++;
      } else {
        const c = await tx.grantBudgetLine.create({ data: { orgId, grantId, ...r } });
        await recordAudit(tx, {
          orgId,
          entity: 'GrantBudgetLine',
          entityId: c.id,
          action: 'create',
          after: c,
        });
        created++;
      }
    }
    await markCurrentRunStale(tx, orgId);
    return { created, updated };
  });
}

/** % spent per grant from the current compute run (blank when no run). */
export async function spentByGrant(orgId: string): Promise<Map<string, number> | null> {
  const run = await prisma.computeRun.findFirst({
    where: { orgId, isCurrent: true },
    select: { id: true },
  });
  if (!run) return null;
  const rows = await prisma.allocatedLine.groupBy({
    by: ['grantId'],
    _sum: { amountCents: true },
    where: { computeRunId: run.id, grantId: { not: null }, status: 'ok' },
  });
  return new Map(rows.map((r) => [r.grantId!, r._sum.amountCents ?? 0]));
}
