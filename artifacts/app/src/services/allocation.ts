import { z } from 'zod';
import type { Prisma } from '@/generated/prisma/client';
import { prisma } from '@/lib/db';
import { recordAudit } from '@/lib/audit';
import { markCurrentRunStale } from '@/lib/stale';
import { isEmptyMatchers, matchersSchema } from '@/domain/matchers';
import { formatCents } from '@/domain/money';
import { ValidationError } from '@/services/programs';
import { zodErrors } from '@/lib/forms';

export const allocationInputSchema = z.object({
  name: z.string().trim().min(1, 'Name is required').max(200),
  matchers: matchersSchema,
  method: z.enum(['fixed_pct', 'ratio_of_driver']),
  driverKey: z.string().trim().nullable(),
  priority: z.number().int().min(0),
  effectiveFrom: z.date().nullable(),
  effectiveTo: z.date().nullable(),
  active: z.boolean(),
  targets: z
    .array(
      z.object({
        sortOrder: z.number().int().min(0),
        programId: z.string().nullable(),
        grantBudgetLineId: z.string().nullable(),
        shareBps: z.number().int().min(0).max(10000),
      }),
    )
    .min(1, 'Add at least one target'),
});
export type AllocationInput = z.infer<typeof allocationInputSchema>;

async function validate(orgId: string, input: AllocationInput) {
  const parsed = allocationInputSchema.safeParse(input);
  if (!parsed.success) throw new ValidationError(zodErrors(parsed.error));
  const data = parsed.data;
  const errors: Record<string, string> = {};
  if (data.matchers.programIds?.length)
    errors.matchers = 'Program conditions are not supported for allocation';
  if (isEmptyMatchers(data.matchers)) errors.matchers = 'Add at least one matching condition';
  if (
    data.matchers.accountRange &&
    (!data.matchers.accountRange.from || !data.matchers.accountRange.to)
  )
    errors.accountRange = 'Enter both ends of the account range';
  if (
    data.matchers.dateFrom &&
    data.matchers.dateTo &&
    data.matchers.dateFrom > data.matchers.dateTo
  )
    errors.dateTo = 'End date must be on or after start date';
  if (data.effectiveFrom && data.effectiveTo && data.effectiveFrom > data.effectiveTo)
    errors.effectiveTo = 'End date must be on or after start date';
  if (data.method === 'ratio_of_driver' && !data.driverKey)
    errors.driverKey = 'Driver key is required';
  const ids = data.targets.flatMap((t) =>
    [t.programId, t.grantBudgetLineId].filter((id): id is string => !!id),
  );
  const [programs, lines] = await Promise.all([
    prisma.program.findMany({ where: { orgId, id: { in: ids } }, select: { id: true } }),
    prisma.grantBudgetLine.findMany({
      where: { orgId, id: { in: ids } },
      select: { id: true, programId: true },
    }),
  ]);
  const programSet = new Set(programs.map((p) => p.id));
  const lineMap = new Map(lines.map((l) => [l.id, l]));
  const seen = new Set<string>();
  for (const t of data.targets) {
    if (!t.programId && !t.grantBudgetLineId)
      errors.targets = 'Each target needs a program or budget line';
    if (t.programId && !programSet.has(t.programId))
      errors.targets = 'Target program does not belong to this organization';
    if (t.grantBudgetLineId && !lineMap.has(t.grantBudgetLineId))
      errors.targets = 'Target budget line does not belong to this organization';
    const line = t.grantBudgetLineId ? lineMap.get(t.grantBudgetLineId) : null;
    if (line?.programId && t.programId && line.programId !== t.programId)
      errors.targets = 'Target program must match the budget line program';
    const key = `${t.programId ?? line?.programId ?? ''}|${t.grantBudgetLineId ?? ''}`;
    if (seen.has(key)) errors.targets = 'Duplicate targets are not allowed';
    seen.add(key);
  }
  if (data.method === 'fixed_pct') {
    const sum = data.targets.reduce((n, t) => n + t.shareBps, 0);
    if (sum !== 10000) errors.targets = `Shares must total 100.00%; currently ${formatCents(sum)}%`;
  }
  if (Object.keys(errors).length) throw new ValidationError(errors);
  const { programIds: _programIds, ...matchers } = data.matchers;
  void _programIds;
  return {
    ...data,
    matchers,
    driverKey: data.method === 'fixed_pct' ? null : data.driverKey,
    targets: data.targets.map((t) => ({
      ...t,
      shareBps: data.method === 'ratio_of_driver' ? 0 : t.shareBps,
    })),
  };
}

export async function createAllocationRule(orgId: string, input: AllocationInput) {
  const { targets, matchers, ...data } = await validate(orgId, input);
  return prisma.$transaction(async (tx) => {
    const after = await tx.allocationRule.create({
      data: {
        orgId,
        ...data,
        matchers: matchers as Prisma.InputJsonValue,
        targets: { create: targets },
      },
      include: { targets: true },
    });
    await recordAudit(tx, {
      orgId,
      entity: 'AllocationRule',
      entityId: after.id,
      action: 'create',
      after,
    });
    await markCurrentRunStale(tx, orgId);
    return after;
  });
}

export async function updateAllocationRule(orgId: string, id: string, input: AllocationInput) {
  const { targets, matchers, ...data } = await validate(orgId, input);
  return prisma.$transaction(async (tx) => {
    const before = await tx.allocationRule.findFirst({
      where: { id, orgId },
      include: { targets: true },
    });
    if (!before) throw new ValidationError({ _: 'Allocation rule not found' });
    await tx.allocationTarget.deleteMany({ where: { allocationRuleId: id } });
    const after = await tx.allocationRule.update({
      where: { id },
      data: { ...data, matchers: matchers as Prisma.InputJsonValue, targets: { create: targets } },
      include: { targets: true },
    });
    await recordAudit(tx, {
      orgId,
      entity: 'AllocationRule',
      entityId: id,
      action: 'update',
      before,
      after,
    });
    await markCurrentRunStale(tx, orgId);
    return after;
  });
}

export async function deleteAllocationRule(
  orgId: string,
  id: string,
): Promise<{ deactivated: boolean }> {
  return prisma.$transaction(async (tx) => {
    const before = await tx.allocationRule.findFirst({
      where: { id, orgId },
      include: { targets: true },
    });
    if (!before) throw new ValidationError({ _: 'Allocation rule not found' });
    const referenced = await tx.allocatedLine.count({ where: { orgId, allocationRuleId: id } });
    if (referenced) {
      const after = await tx.allocationRule.update({
        where: { id },
        data: { active: false },
        include: { targets: true },
      });
      await recordAudit(tx, {
        orgId,
        entity: 'AllocationRule',
        entityId: id,
        action: 'update',
        before,
        after,
      });
    } else {
      await tx.allocationRule.delete({ where: { id } });
      await recordAudit(tx, {
        orgId,
        entity: 'AllocationRule',
        entityId: id,
        action: 'delete',
        before,
      });
    }
    await markCurrentRunStale(tx, orgId);
    return { deactivated: !!referenced };
  });
}

export async function upsertDriverValues(
  orgId: string,
  driverKey: string,
  period: string,
  rows: Array<{ programId: string; value: number }>,
) {
  const schema = z.object({
    driverKey: z.string().trim().min(1, 'Driver key is required'),
    period: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'Period must be YYYY-MM'),
    rows: z.array(
      z.object({ programId: z.string().min(1), value: z.number().int().min(0).max(2147483647) }),
    ),
  });
  const parsed = schema.safeParse({ driverKey, period, rows });
  if (!parsed.success) throw new ValidationError(zodErrors(parsed.error));
  if (new Set(rows.map((r) => r.programId)).size !== rows.length)
    throw new ValidationError({ rows: 'Duplicate programs' });
  const count = await prisma.program.count({
    where: { orgId, id: { in: rows.map((r) => r.programId) } },
  });
  if (count !== rows.length) throw new ValidationError({ rows: 'Unknown program' });
  return prisma.$transaction(async (tx) => {
    const where = { orgId, driverKey: parsed.data.driverKey, period };
    const before = await tx.allocationDriverValue.findMany({ where });
    await tx.allocationDriverValue.deleteMany({ where });
    if (rows.length)
      await tx.allocationDriverValue.createMany({ data: rows.map((r) => ({ ...where, ...r })) });
    const after = await tx.allocationDriverValue.findMany({ where });
    await recordAudit(tx, {
      orgId,
      entity: 'AllocationDriverValue',
      entityId: `${driverKey}:${period}`,
      action: before.length ? 'update' : 'create',
      before,
      after,
    });
    await markCurrentRunStale(tx, orgId);
    return after;
  });
}
