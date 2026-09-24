import { z } from 'zod';
import { prisma } from '@/lib/db';
import { recordAudit } from '@/lib/audit';
import { markCurrentRunStale } from '@/lib/stale';

export const programInputSchema = z.object({
  code: z
    .string()
    .trim()
    .min(1, 'Code is required')
    .max(20, 'Code must be 20 characters or fewer')
    .regex(/^[A-Za-z0-9_-]+$/, 'Letters, numbers, dash and underscore only'),
  name: z.string().trim().min(1, 'Name is required').max(120),
  description: z.string().trim().max(2000).nullable(),
  functionalCategory: z.enum(['program', 'management_general', 'fundraising']),
  matchClassIds: z.array(z.string()),
  active: z.boolean(),
});
export type ProgramInput = z.infer<typeof programInputSchema>;

export class ValidationError extends Error {
  constructor(public readonly fieldErrors: Record<string, string>) {
    super('Validation failed');
    this.name = 'ValidationError';
  }
}

/** A class may be the default for at most one program. */
async function assertClassesFree(orgId: string, classIds: string[], exceptProgramId?: string) {
  if (classIds.length === 0) return;
  const clash = await prisma.program.findFirst({
    where: {
      orgId,
      matchClassIds: { hasSome: classIds },
      ...(exceptProgramId ? { id: { not: exceptProgramId } } : {}),
    },
    select: { code: true, matchClassIds: true },
  });
  if (clash) {
    const shared = clash.matchClassIds.filter((c) => classIds.includes(c));
    const names = await prisma.trackingClass.findMany({
      where: { id: { in: shared } },
      select: { name: true },
    });
    throw new ValidationError({
      matchClassIds: `Class ${names.map((n) => n.name).join(', ')} is already the default for program ${clash.code}`,
    });
  }
}

export async function createProgram(orgId: string, input: ProgramInput) {
  const dup = await prisma.program.findUnique({
    where: { orgId_code: { orgId, code: input.code } },
  });
  if (dup) throw new ValidationError({ code: `Program code ${input.code} already exists` });
  await assertClassesFree(orgId, input.matchClassIds);
  return prisma.$transaction(async (tx) => {
    const p = await tx.program.create({ data: { orgId, ...input } });
    await recordAudit(tx, { orgId, entity: 'Program', entityId: p.id, action: 'create', after: p });
    await markCurrentRunStale(tx, orgId);
    return p;
  });
}

export async function updateProgram(orgId: string, id: string, input: ProgramInput) {
  const before = await prisma.program.findFirst({ where: { id, orgId } });
  if (!before) throw new ValidationError({ _: 'Program not found' });
  const dup = await prisma.program.findFirst({
    where: { orgId, code: input.code, id: { not: id } },
  });
  if (dup) throw new ValidationError({ code: `Program code ${input.code} already exists` });
  await assertClassesFree(orgId, input.matchClassIds, id);
  return prisma.$transaction(async (tx) => {
    const after = await tx.program.update({ where: { id }, data: input });
    await recordAudit(tx, {
      orgId,
      entity: 'Program',
      entityId: id,
      action: 'update',
      before,
      after,
    });
    await markCurrentRunStale(tx, orgId);
    return after;
  });
}

export async function deleteProgram(orgId: string, id: string) {
  const before = await prisma.program.findFirst({ where: { id, orgId } });
  if (!before) throw new ValidationError({ _: 'Program not found' });
  const refs = await prisma.allocatedLine.count({ where: { programId: id } });
  const grantRefs = await prisma.grantProgram.count({ where: { programId: id } });
  const targetRefs = await prisma.allocationTarget.count({ where: { programId: id } });
  if (refs > 0 || grantRefs > 0 || targetRefs > 0) {
    // Referenced: deactivate instead of deleting.
    return prisma.$transaction(async (tx) => {
      const after = await tx.program.update({ where: { id }, data: { active: false } });
      await recordAudit(tx, {
        orgId,
        entity: 'Program',
        entityId: id,
        action: 'update',
        before,
        after,
      });
      await markCurrentRunStale(tx, orgId);
      return { deleted: false as const };
    });
  }
  return prisma.$transaction(async (tx) => {
    await tx.program.delete({ where: { id } });
    await recordAudit(tx, { orgId, entity: 'Program', entityId: id, action: 'delete', before });
    await markCurrentRunStale(tx, orgId);
    return { deleted: true as const };
  });
}
