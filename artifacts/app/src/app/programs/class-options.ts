import type { prisma as PrismaType } from '@/lib/db';

export async function classOptions(
  prisma: typeof PrismaType,
  orgId: string,
  exceptProgramId: string | null,
) {
  const [classes, programs] = await Promise.all([
    prisma.trackingClass.findMany({ where: { orgId, deletedAt: null }, orderBy: { name: 'asc' } }),
    prisma.program.findMany({
      where: { orgId },
      select: { id: true, code: true, matchClassIds: true },
    }),
  ]);
  const takenBy = new Map<string, string>();
  for (const p of programs) {
    if (p.id === exceptProgramId) continue;
    for (const c of p.matchClassIds) takenBy.set(c, p.code);
  }
  return classes.map((c) => ({ id: c.id, name: c.name, takenBy: takenBy.get(c.id) ?? null }));
}
