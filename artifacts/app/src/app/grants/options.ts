import { prisma } from '@/lib/db';

export async function grantFormOptions(orgId: string) {
  const [customers, classes, programs] = await Promise.all([
    prisma.party.findMany({
      where: { orgId, kind: 'customer', deletedAt: null },
      orderBy: { displayName: 'asc' },
      select: { id: true, displayName: true },
    }),
    prisma.trackingClass.findMany({
      where: { orgId, deletedAt: null },
      orderBy: { name: 'asc' },
      select: { id: true, name: true },
    }),
    prisma.program.findMany({
      where: { orgId, active: true },
      orderBy: { code: 'asc' },
      select: { id: true, code: true, name: true },
    }),
  ]);
  return { customers, classes, programs };
}
