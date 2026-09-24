import { z } from 'zod';
import { prisma } from '@/lib/db';
import { recordAudit } from '@/lib/audit';
import { markCurrentRunStale } from '@/lib/stale';
import { MAX_CENTS } from '@/domain/money';
import { ValidationError } from '@/services/programs';

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
export type GrantInput = z.infer<typeof grantInputSchema>;

export async function createGrant(orgId: string, input: GrantInput) {
  const { programs, ...data } = input;
  return prisma.$transaction(async (tx) => {
    const g = await tx.grant.create({
      data: { orgId, ...data, programs: { create: programs } },
      include: { programs: true },
    });
    await recordAudit(tx, { orgId, entity: 'Grant', entityId: g.id, action: 'create', after: g });
    await markCurrentRunStale(tx, orgId);
    return g;
  });
}

export async function updateGrant(orgId: string, id: string, input: GrantInput) {
  const before = await prisma.grant.findFirst({
    where: { id, orgId },
    include: { programs: true },
  });
  if (!before) throw new ValidationError({ _: 'Grant not found' });
  const { programs, ...data } = input;
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
    await markCurrentRunStale(tx, orgId);
    return after;
  });
}

/** Hard delete only when no ComputeRun references the grant; otherwise archive. */
export async function deleteOrArchiveGrant(
  orgId: string,
  id: string,
): Promise<{ archived: boolean }> {
  const before = await prisma.grant.findFirst({
    where: { id, orgId },
    include: { programs: true, budgetLines: true },
  });
  if (!before) throw new ValidationError({ _: 'Grant not found' });
  const referenced = await prisma.allocatedLine.count({
    where: { OR: [{ grantId: id }, { grantBudgetLine: { grantId: id } }] },
  });
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
});
export type BudgetLineInput = z.infer<typeof budgetLineInputSchema>;

export async function upsertBudgetLine(
  orgId: string,
  grantId: string,
  input: BudgetLineInput,
  id?: string,
) {
  const grant = await prisma.grant.findFirst({ where: { id: grantId, orgId } });
  if (!grant) throw new ValidationError({ _: 'Grant not found' });
  const dup = await prisma.grantBudgetLine.findFirst({
    where: { grantId, code: input.code, ...(id ? { id: { not: id } } : {}) },
  });
  if (dup) throw new ValidationError({ code: `Code ${input.code} is already used in this grant` });
  return prisma.$transaction(async (tx) => {
    if (id) {
      const before = await tx.grantBudgetLine.findFirstOrThrow({ where: { id, grantId } });
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
export async function importBudgetLines(orgId: string, grantId: string, rows: BudgetLineInput[]) {
  return prisma.$transaction(async (tx) => {
    let created = 0;
    let updated = 0;
    for (const r of rows) {
      const existing = await tx.grantBudgetLine.findUnique({
        where: { grantId_code: { grantId, code: r.code } },
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
