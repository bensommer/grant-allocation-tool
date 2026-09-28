/**
 * Options and live counts for "How QuickBooks tracks this grant" (JPH-29 E3): every class and
 * customer / project in the imported books with the number of transactions carrying it.
 */
import { prisma } from '@/lib/db';

export interface TrackingOption {
  id: string;
  name: string;
  /** Transactions in the books tagged with this class / name. */
  count: number;
  kind?: 'customer' | 'project';
}

export interface TrackingOptions {
  classes: TrackingOption[];
  parties: TrackingOption[];
}

export async function trackingOptions(orgId: string): Promise<TrackingOptions> {
  const [classes, parties, byClass, byParty] = await Promise.all([
    prisma.trackingClass.findMany({
      where: { orgId, deletedAt: null },
      orderBy: { name: 'asc' },
      select: { id: true, name: true },
    }),
    prisma.party.findMany({
      where: { orgId, kind: { in: ['customer', 'project'] }, deletedAt: null },
      orderBy: { displayName: 'asc' },
      select: { id: true, displayName: true, kind: true },
    }),
    prisma.transactionLine.groupBy({
      by: ['classId'],
      where: { orgId, deletedAt: null, classId: { not: null } },
      _count: { _all: true },
    }),
    prisma.transactionLine.groupBy({
      by: ['partyId'],
      where: { orgId, deletedAt: null, partyId: { not: null } },
      _count: { _all: true },
    }),
  ]);
  const classCount = new Map(byClass.map((r) => [r.classId, r._count._all]));
  const partyCount = new Map(byParty.map((r) => [r.partyId, r._count._all]));
  return {
    classes: classes.map((c) => ({ id: c.id, name: c.name, count: classCount.get(c.id) ?? 0 })),
    parties: parties.map((p) => ({
      id: p.id,
      name: p.displayName,
      count: partyCount.get(p.id) ?? 0,
      kind: p.kind === 'project' ? 'project' : 'customer',
    })),
  };
}
