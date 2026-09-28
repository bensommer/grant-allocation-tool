import { z } from 'zod';
import type { Prisma } from '@/generated/prisma/client';
import { prisma } from '@/lib/db';
import { recordAudit } from '@/lib/audit';
import { markCurrentRunStale } from '@/lib/stale';
import { isEmptyMatchers, matchersSchema } from '@/domain/matchers';
import { assertMatcherRefs } from './refs';
import { ValidationError } from '@/services/programs';
import { zodErrors } from '@/lib/forms';

export const crosswalkInputSchema = z.object({
  name: z.string().trim().min(1, 'Name is required').max(200),
  grantBudgetLineId: z.string().min(1, 'Select a budget line'),
  priority: z.number().int('Priority must be an integer').min(0, 'Priority cannot be negative'),
  active: z.boolean(),
  matchers: matchersSchema
    .refine((m) => !isEmptyMatchers(m), 'Add at least one condition')
    .refine(
      (m) => !m.accountRange || (!!m.accountRange.from && !!m.accountRange.to),
      'Enter both account range endpoints',
    ),
});
export type CrosswalkInput = z.infer<typeof crosswalkInputSchema>;

async function validate(orgId: string, input: CrosswalkInput) {
  const result = crosswalkInputSchema.safeParse(input);
  if (!result.success) throw new ValidationError(zodErrors(result.error));
  const line = await prisma.grantBudgetLine.findFirst({
    where: { id: result.data.grantBudgetLineId, orgId },
  });
  if (!line) throw new ValidationError({ grantBudgetLineId: 'Budget line not found' });
  await assertMatcherRefs(prisma, orgId, result.data.matchers);
  return { ...result.data, matchers: result.data.matchers as Prisma.InputJsonValue };
}

export async function createCrosswalkRule(orgId: string, input: CrosswalkInput) {
  const data = await validate(orgId, input);
  return prisma.$transaction(async (tx) => {
    const after = await tx.crosswalkRule.create({ data: { orgId, ...data } });
    await recordAudit(tx, {
      orgId,
      entity: 'CrosswalkRule',
      entityId: after.id,
      action: 'create',
      after,
    });
    await markCurrentRunStale(tx, orgId);
    return after;
  });
}

export async function updateCrosswalkRule(orgId: string, id: string, input: CrosswalkInput) {
  const data = await validate(orgId, input);
  return prisma.$transaction(async (tx) => {
    const before = await tx.crosswalkRule.findFirst({ where: { id, orgId } });
    if (!before) throw new ValidationError({ _: 'Crosswalk rule not found' });
    const after = await tx.crosswalkRule.update({ where: { id }, data });
    await recordAudit(tx, {
      orgId,
      entity: 'CrosswalkRule',
      entityId: id,
      action: 'update',
      before,
      after,
    });
    await markCurrentRunStale(tx, orgId);
    return after;
  });
}

export async function deleteCrosswalkRule(
  orgId: string,
  id: string,
): Promise<{ deactivated: boolean }> {
  return prisma.$transaction(async (tx) => {
    const before = await tx.crosswalkRule.findFirst({ where: { id, orgId } });
    if (!before) throw new ValidationError({ _: 'Crosswalk rule not found' });
    const references = await tx.allocatedLine.count({ where: { orgId, crosswalkRuleId: id } });
    if (references) {
      const after = await tx.crosswalkRule.update({ where: { id }, data: { active: false } });
      await recordAudit(tx, {
        orgId,
        entity: 'CrosswalkRule',
        entityId: id,
        action: 'update',
        before,
        after,
      });
    } else {
      await tx.crosswalkRule.delete({ where: { id } });
      await recordAudit(tx, {
        orgId,
        entity: 'CrosswalkRule',
        entityId: id,
        action: 'delete',
        before,
      });
    }
    await markCurrentRunStale(tx, orgId);
    return { deactivated: references > 0 };
  });
}
