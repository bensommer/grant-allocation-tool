import type { Prisma, PrismaClient } from '@/generated/prisma/client';

/**
 * Grant membership (JPH-20): which source lines belong to which grant.
 *
 *  - import_scope   the line came in through a report import scoped to the grant
 *                   (written by the ImportService)
 *  - class_match    the line's class is in Grant.memberClassIds
 *  - project_match  the line (or its transaction) is tagged with a customer/
 *                   project party in Grant.memberPartyIds
 *
 * Memberships are never hard-deleted; when a rule no longer matches the row is
 * superseded so history stays reconstructible.
 */

type Db = PrismaClient | Prisma.TransactionClient;

export interface MembershipSyncCounts {
  added: number;
  superseded: number;
}

const CHUNK = 500;
function chunk<T>(items: T[]): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += CHUNK) out.push(items.slice(i, i + CHUNK));
  return out;
}

/**
 * Bring class_match / project_match memberships in line with the grant's
 * member lists. Pass a grantId after saving that grant; omit it after an import
 * so every grant with member rules picks up the new lines.
 */
export async function syncRuleMemberships(
  db: Db,
  orgId: string,
  grantId?: string,
): Promise<MembershipSyncCounts> {
  const grants = await db.grant.findMany({
    where: grantId
      ? { id: grantId, orgId }
      : {
          orgId,
          OR: [{ memberClassIds: { isEmpty: false } }, { memberPartyIds: { isEmpty: false } }],
        },
    select: { id: true, memberClassIds: true, memberPartyIds: true },
  });
  const counts: MembershipSyncCounts = { added: 0, superseded: 0 };
  const now = new Date();
  for (const grant of grants) {
    const classLines =
      grant.memberClassIds.length === 0
        ? []
        : await db.transactionLine.findMany({
            where: {
              orgId,
              deletedAt: null,
              classId: { in: grant.memberClassIds },
              transaction: { deletedAt: null },
            },
            select: { id: true },
          });
    const projectLines =
      grant.memberPartyIds.length === 0
        ? []
        : await db.transactionLine.findMany({
            where: {
              orgId,
              deletedAt: null,
              transaction: { deletedAt: null },
              OR: [
                { partyId: { in: grant.memberPartyIds } },
                { transaction: { partyId: { in: grant.memberPartyIds } } },
              ],
            },
            select: { id: true },
          });
    const wanted = new Map<string, 'class_match' | 'project_match'>();
    for (const l of classLines) wanted.set(l.id, 'class_match');
    for (const l of projectLines) if (!wanted.has(l.id)) wanted.set(l.id, 'project_match');

    // A line can hold one active row per reason (import_scope, class_match,
    // project_match); reasons are independent so dropping a rule never removes
    // a membership the grant's own report established.
    const active = await db.grantMembership.findMany({
      where: { orgId, grantId: grant.id, supersededAt: null, via: { not: 'import_scope' } },
      select: { id: true, transactionLineId: true, via: true },
    });
    const activeByLine = new Map(active.map((m) => [m.transactionLineId, m]));

    const toSupersede = active
      .filter((m) => wanted.get(m.transactionLineId) !== m.via)
      .map((m) => m.id);
    for (const ids of chunk(toSupersede)) {
      await db.grantMembership.updateMany({
        where: { id: { in: ids } },
        data: { supersededAt: now },
      });
      counts.superseded += ids.length;
    }
    const toAdd = [...wanted.entries()].filter(
      ([lineId, via]) => activeByLine.get(lineId)?.via !== via,
    );
    for (const rows of chunk(toAdd)) {
      await db.grantMembership.createMany({
        data: rows.map(([transactionLineId, via]) => ({
          orgId,
          grantId: grant.id,
          transactionLineId,
          via,
        })),
      });
      counts.added += rows.length;
    }
  }
  return counts;
}

/**
 * Record import-scope membership for every line of the given transactions.
 * Lines that already carry an active import-scope row for the grant are left
 * alone; a rule-based row on the same line does not count, so the report's
 * own evidence survives a later rule change.
 */
export async function addImportScopeMemberships(
  db: Db,
  orgId: string,
  grantId: string,
  importBatchId: string,
  transactionIds: string[],
): Promise<number> {
  let added = 0;
  for (const ids of chunk(transactionIds)) {
    const lines = await db.transactionLine.findMany({
      where: { transactionId: { in: ids }, deletedAt: null },
      select: {
        id: true,
        memberships: {
          where: { grantId, supersededAt: null, via: 'import_scope' },
          select: { id: true },
        },
      },
    });
    const missing = lines.filter((l) => l.memberships.length === 0).map((l) => l.id);
    if (missing.length === 0) continue;
    await db.grantMembership.createMany({
      data: missing.map((transactionLineId) => ({
        orgId,
        grantId,
        transactionLineId,
        via: 'import_scope' as const,
        importBatchId,
      })),
    });
    added += missing.length;
  }
  return added;
}

/** Supersede the grant's memberships on lines that left the scoped export. */
export async function supersedeMemberships(
  db: Db,
  grantId: string,
  transactionLineIds: string[],
  at = new Date(),
): Promise<number> {
  let n = 0;
  for (const ids of chunk(transactionLineIds)) {
    const r = await db.grantMembership.updateMany({
      where: { grantId, transactionLineId: { in: ids }, supersededAt: null },
      data: { supersededAt: at },
    });
    n += r.count;
  }
  return n;
}

export interface ScopeSummary {
  memberLines: number;
  incomeCents: number;
  expenseCents: number;
  classes: string[];
}

/**
 * What the batch page shows for a scoped import: the grant's current member
 * lines inside the scope's date range and their income / expense totals.
 */
export async function scopeSummary(
  db: Db,
  orgId: string,
  scope: { grantId: string; dateFrom: Date; dateTo: Date },
): Promise<ScopeSummary> {
  const lines = await db.transactionLine.findMany({
    where: {
      orgId,
      deletedAt: null,
      transaction: { deletedAt: null, txnDate: { gte: scope.dateFrom, lte: scope.dateTo } },
      memberships: { some: { grantId: scope.grantId, supersededAt: null } },
    },
    select: {
      amountCents: true,
      account: { select: { type: true } },
      class: { select: { name: true } },
    },
  });
  const summary: ScopeSummary = { memberLines: 0, incomeCents: 0, expenseCents: 0, classes: [] };
  const classes = new Set<string>();
  for (const l of lines) {
    summary.memberLines++;
    if (l.account.type === 'Income' || l.account.type === 'OtherIncome')
      summary.incomeCents += l.amountCents;
    else summary.expenseCents += l.amountCents;
    if (l.class) classes.add(l.class.name);
  }
  summary.classes = [...classes].sort();
  return summary;
}
