import type { Prisma } from '@/generated/prisma/client';
import { prisma } from '@/lib/db';

type Db = Prisma.TransactionClient | typeof prisma;

/** Any overlay-config change invalidates the current compute run (banner: "Configuration changed — recompute"). */
export async function markCurrentRunStale(db: Db, orgId: string): Promise<void> {
  await db.computeRun.updateMany({
    where: { orgId, isCurrent: true, stale: false },
    data: { stale: true },
  });
}
