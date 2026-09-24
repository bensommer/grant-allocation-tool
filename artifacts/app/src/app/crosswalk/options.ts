import { prisma } from '@/lib/db';

export async function crosswalkOptions(orgId: string) {
  const [grants, programs, accounts, classes, locations, parties] = await Promise.all([
    prisma.grant.findMany({
      where: { orgId },
      include: { budgetLines: { orderBy: { sortOrder: 'asc' } } },
      orderBy: { name: 'asc' },
    }),
    prisma.program.findMany({ where: { orgId }, orderBy: { code: 'asc' } }),
    prisma.account.findMany({
      where: { orgId, type: { in: ['Expense', 'COGS', 'OtherExpense'] }, deletedAt: null },
      orderBy: { number: 'asc' },
    }),
    prisma.trackingClass.findMany({ where: { orgId, deletedAt: null }, orderBy: { name: 'asc' } }),
    prisma.trackingLocation.findMany({
      where: { orgId, deletedAt: null },
      orderBy: { name: 'asc' },
    }),
    prisma.party.findMany({ where: { orgId, deletedAt: null }, orderBy: { displayName: 'asc' } }),
  ]);
  return { grants, programs, accounts, classes, locations, parties };
}
