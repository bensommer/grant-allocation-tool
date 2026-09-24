import type { Prisma } from '@/generated/prisma/client';
import { prisma } from '@/lib/db';
import type { Matchers } from '@/domain/matchers';
import { ValidationError } from './programs';

type Db = Prisma.TransactionClient | typeof prisma;

/**
 * Every id submitted from a form must belong to the caller's org. Throws a
 * ValidationError on the given field when any id is unknown or foreign.
 */
export async function assertOrgRefs(
  db: Db,
  orgId: string,
  field: string,
  refs: {
    programIds?: string[];
    accountIds?: string[];
    classIds?: string[];
    locationIds?: string[];
    partyIds?: string[];
    grantIds?: string[];
    grantBudgetLineIds?: string[];
  },
): Promise<void> {
  const check = async (
    ids: string[] | undefined,
    count: (ids: string[]) => Promise<number>,
    what: string,
  ) => {
    const uniq = [...new Set((ids ?? []).filter(Boolean))];
    if (uniq.length === 0) return;
    const n = await count(uniq);
    if (n !== uniq.length) throw new ValidationError({ [field]: `Unknown ${what} selected` });
  };
  await check(
    refs.programIds,
    (ids) => db.program.count({ where: { orgId, id: { in: ids } } }),
    'program',
  );
  await check(
    refs.accountIds,
    (ids) => db.account.count({ where: { orgId, id: { in: ids } } }),
    'account',
  );
  await check(
    refs.classIds,
    (ids) => db.trackingClass.count({ where: { orgId, id: { in: ids } } }),
    'class',
  );
  await check(
    refs.locationIds,
    (ids) => db.trackingLocation.count({ where: { orgId, id: { in: ids } } }),
    'location',
  );
  await check(
    refs.partyIds,
    (ids) => db.party.count({ where: { orgId, id: { in: ids } } }),
    'party',
  );
  await check(
    refs.grantIds,
    (ids) => db.grant.count({ where: { orgId, id: { in: ids } } }),
    'grant',
  );
  await check(
    refs.grantBudgetLineIds,
    (ids) => db.grantBudgetLine.count({ where: { orgId, id: { in: ids } } }),
    'budget line',
  );
}

export async function assertMatcherRefs(
  db: Db,
  orgId: string,
  m: Matchers,
  field = 'matchers',
): Promise<void> {
  await assertOrgRefs(db, orgId, field, {
    programIds: m.programIds,
    accountIds: m.accountIds,
    classIds: m.classIds,
    locationIds: m.locationIds,
    partyIds: m.partyIds,
  });
}
