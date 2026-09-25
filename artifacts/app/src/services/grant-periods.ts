/**
 * Periods, release classes and the restricted-funds rollforward (JPH-23).
 *
 * Release to date per class comes from the current run: assigned transaction
 * lines (dated) plus effort charges (undated, always counted in full). Closed
 * periods are never recomputed — a period's snapshot rows (reported by the
 * bookkeeper, or computed when the app locked it) are the figures of record,
 * and today's books are shown against them as drift. Where no snapshot covers
 * an earlier stretch of a grant, the dated books fill the gap.
 */
import { z } from 'zod';
import type { Prisma } from '@/generated/prisma/client';
import { prisma } from '@/lib/db';
import { recordAudit } from '@/lib/audit';
import { utcDate } from '@/domain/dates';
import { MAX_CENTS } from '@/domain/money';
import {
  RELEASE_CLASSES,
  addByClass,
  rollforwardColumn,
  rollforwardTotals,
  zeroByClass,
  type ByClass,
  type ReleaseClass,
  type RollforwardColumn,
} from '@/domain/periods';
import { matchesReceived } from '@/domain/received';
import { ValidationError } from '@/services/programs';

type Db = Prisma.TransactionClient | typeof prisma;
const DAY = 86_400_000;
const dayBefore = (d: Date) => new Date(d.getTime() - DAY);

// --- books ---------------------------------------------------------------------

async function currentRunId(orgId: string): Promise<string | null> {
  const run = await prisma.computeRun.findFirst({
    where: { orgId, isCurrent: true },
    select: { id: true },
  });
  return run?.id ?? null;
}

/**
 * Assigned transaction lines by release class, dated within [from, to]
 * (either bound optional). Effort charges are not included.
 */
export async function bookedByClass(
  orgId: string,
  grantId: string,
  range: { from?: Date; to?: Date },
): Promise<ByClass> {
  const runId = await currentRunId(orgId);
  const out = zeroByClass();
  if (!runId) return out;
  const rows = await prisma.grantLineResult.findMany({
    where: {
      computeRunId: runId,
      grantId,
      state: 'assigned',
      source: 'transaction',
      budgetLineId: { not: null },
      line: { transaction: { txnDate: { gte: range.from, lte: range.to } } },
    },
    select: { amountCents: true, budgetLine: { select: { releaseClass: true } } },
  });
  for (const r of rows) out[r.budgetLine!.releaseClass] += r.amountCents;
  return out;
}

/** Effort charges by release class in the current run (undated). */
export async function effortByClass(orgId: string, grantId: string): Promise<ByClass> {
  const runId = await currentRunId(orgId);
  const out = zeroByClass();
  if (!runId) return out;
  const rows = await prisma.grantLineResult.findMany({
    where: { computeRunId: runId, grantId, state: 'assigned', source: 'effort' },
    select: { amountCents: true, budgetLine: { select: { releaseClass: true } } },
  });
  for (const r of rows) out[r.budgetLine?.releaseClass ?? 'staff'] += r.amountCents;
  return out;
}

/** Released to date per class: dated lines through `to` plus all effort charges. */
export async function releasedToDate(orgId: string, grantId: string, to: Date): Promise<ByClass> {
  const [booked, effort] = await Promise.all([
    bookedByClass(orgId, grantId, { to }),
    effortByClass(orgId, grantId),
  ]);
  return addByClass(booked, effort);
}

/**
 * Grant income within [from, to]: member income lines (scoped exports) plus lines the
 * grant's revenue matchers pick up, each line counted once.
 */
export async function receivedBetween(
  orgId: string,
  grantId: string,
  range: { from?: Date; to?: Date },
): Promise<number> {
  const grant = await prisma.grant.findFirst({
    where: { id: grantId, orgId },
    select: { matchPartyIds: true, matchClassIds: true, revenueAccountId: true },
  });
  if (!grant) return 0;
  const rows = await prisma.transactionLine.findMany({
    where: {
      orgId,
      deletedAt: null,
      account: { type: { in: ['Income', 'OtherIncome'] } },
      transaction: { deletedAt: null, txnDate: { gte: range.from, lte: range.to } },
    },
    select: {
      amountCents: true,
      accountId: true,
      classId: true,
      partyId: true,
      account: { select: { type: true } },
      transaction: { select: { partyId: true } },
      memberships: { where: { grantId, supersededAt: null }, select: { id: true } },
    },
  });
  let total = 0;
  for (const r of rows) {
    const member = r.memberships.length > 0;
    const matched = matchesReceived(grant, {
      accountId: r.accountId,
      accountType: r.account.type,
      classId: r.classId,
      transactionPartyId: r.transaction.partyId,
      linePartyId: r.partyId,
    });
    if (member || matched) total += r.amountCents;
  }
  return total;
}

// --- snapshots -----------------------------------------------------------------

export interface PeriodSnapshotView {
  lockId: string;
  name: string;
  periodFrom: Date;
  periodTo: Date;
  source: 'computed' | 'reported';
  released: ByClass;
  receivedCents: number;
  note: string | null;
  actor: string;
  createdAt: Date;
}

/** Active snapshot rows of the grant folded into one view per period, oldest first. */
export async function grantPeriodSnapshots(
  orgId: string,
  grantId: string,
): Promise<PeriodSnapshotView[]> {
  const rows = await prisma.grantPeriodSnapshot.findMany({
    where: { orgId, grantId, supersededAt: null },
    include: { lock: true },
    orderBy: [{ lock: { periodFrom: 'asc' } }, { createdAt: 'asc' }],
  });
  const byLock = new Map<string, PeriodSnapshotView>();
  for (const r of rows) {
    let v = byLock.get(r.periodLockId);
    if (!v) {
      v = {
        lockId: r.periodLockId,
        name: r.lock.name,
        periodFrom: r.lock.periodFrom,
        periodTo: r.lock.periodTo,
        source: r.source,
        released: zeroByClass(),
        receivedCents: 0,
        note: r.note,
        actor: r.actor,
        createdAt: r.createdAt,
      };
      byLock.set(r.periodLockId, v);
    }
    if (r.releaseClass) v.released[r.releaseClass] += r.releasedCents;
    else v.receivedCents += r.receivedCents;
    if (r.note && !v.note) v.note = r.note;
  }
  return [...byLock.values()].sort((a, b) => a.periodFrom.getTime() - b.periodFrom.getTime());
}

/**
 * Activity before `from`: snapshot periods that end before `from`, plus dated books
 * outside those periods (effort charges are undated and stay in the current period).
 */
export async function priorActivity(
  orgId: string,
  grantId: string,
  from: Date,
  snapshots?: PeriodSnapshotView[],
): Promise<{ released: ByClass; receivedCents: number; periods: PeriodSnapshotView[] }> {
  const all = snapshots ?? (await grantPeriodSnapshots(orgId, grantId));
  const periods = all.filter((s) => s.periodTo < from);
  let released = zeroByClass();
  let receivedCents = 0;
  for (const p of periods) {
    released = addByClass(released, p.released);
    receivedCents += p.receivedCents;
  }
  // Gaps: stretches before `from` no snapshot covers, walked in date order.
  let cursor: Date | undefined;
  const gaps: Array<{ from?: Date; to: Date }> = [];
  for (const p of periods) {
    if (!cursor || p.periodFrom > cursor) gaps.push({ from: cursor, to: dayBefore(p.periodFrom) });
    const next = new Date(p.periodTo.getTime() + DAY);
    if (!cursor || next > cursor) cursor = next;
  }
  if (!cursor || cursor < from) gaps.push({ from: cursor, to: dayBefore(from) });
  for (const g of gaps) {
    if (g.from && g.from > g.to) continue;
    released = addByClass(released, await bookedByClass(orgId, grantId, g));
    receivedCents += await receivedBetween(orgId, grantId, g);
  }
  return { released, receivedCents, periods };
}

/** Beginning balance at `from`: Σ received − Σ released before the period. */
export async function beginningBalance(orgId: string, grantId: string, from: Date) {
  const prior = await priorActivity(orgId, grantId, from);
  return {
    ...prior,
    beginningCents:
      prior.receivedCents -
      (prior.released.direct + prior.released.staff + prior.released.overhead),
  };
}

// --- rollforward ---------------------------------------------------------------

export interface RollforwardRow extends RollforwardColumn {
  grantId: string;
  name: string;
  funder: string;
  /** Periods whose snapshots fed the beginning balance. */
  priorPeriods: Array<{ name: string; source: 'computed' | 'reported' }>;
}

export interface Rollforward {
  from: Date;
  to: Date;
  runId: string | null;
  rows: RollforwardRow[];
  totals: ReturnType<typeof rollforwardTotals>;
}

/** Current-period figures for one grant: to-date minus everything before `from`. */
export async function grantRollforward(
  orgId: string,
  grantId: string,
  from: Date,
  to: Date,
): Promise<Omit<RollforwardRow, 'name' | 'funder'>> {
  const [prior, toDate, receivedToDate] = await Promise.all([
    priorActivity(orgId, grantId, from),
    releasedToDate(orgId, grantId, to),
    receivedBetween(orgId, grantId, { to }),
  ]);
  const beginningCents =
    prior.receivedCents - (prior.released.direct + prior.released.staff + prior.released.overhead);
  const column = rollforwardColumn(
    beginningCents,
    receivedToDate - prior.receivedCents,
    addByClass(toDate, prior.released, -1),
  );
  return {
    grantId,
    ...column,
    priorPeriods: prior.periods.map((p) => ({ name: p.name, source: p.source })),
  };
}

export async function rollforward(orgId: string, from: Date, to: Date): Promise<Rollforward> {
  const [grants, runId] = await Promise.all([
    prisma.grant.findMany({
      where: { orgId, status: { not: 'archived' }, startDate: { lte: to } },
      orderBy: [{ startDate: 'asc' }, { name: 'asc' }],
      select: { id: true, name: true, funder: true },
    }),
    currentRunId(orgId),
  ]);
  const rows: RollforwardRow[] = [];
  for (const g of grants) {
    const r = await grantRollforward(orgId, g.id, from, to);
    rows.push({ ...r, name: g.name, funder: g.funder });
  }
  return { from, to, runId, rows, totals: rollforwardTotals(rows) };
}

// --- drift against closed periods ----------------------------------------------

export interface PeriodDriftRow {
  period: PeriodSnapshotView;
  cls: ReleaseClass;
  reportedCents: number;
  /** Today's dated books inside the period; null when the class cannot be dated. */
  booksCents: number | null;
  driftCents: number | null;
}

/** Books-vs-snapshot per class for every closed period of the grant. */
export async function periodDrift(orgId: string, grantId: string): Promise<PeriodDriftRow[]> {
  const snapshots = await grantPeriodSnapshots(orgId, grantId);
  const out: PeriodDriftRow[] = [];
  for (const period of snapshots) {
    const books = await bookedByClass(orgId, grantId, {
      from: period.periodFrom,
      to: period.periodTo,
    });
    for (const cls of RELEASE_CLASSES) {
      // Effort charges carry no date, so staff cannot be re-derived for a past period.
      const dated = cls !== 'staff';
      out.push({
        period,
        cls,
        reportedCents: period.released[cls],
        booksCents: dated ? books[cls] : null,
        driftCents: dated ? books[cls] - period.released[cls] : null,
      });
    }
  }
  return out;
}

// --- writing snapshots ---------------------------------------------------------

export const reportedPeriodSchema = z.object({
  name: z.string().trim().min(1, 'Name is required').max(100),
  periodFrom: z.date(),
  periodTo: z.date(),
  directCents: z.number().int().min(0).max(MAX_CENTS),
  staffCents: z.number().int().min(0).max(MAX_CENTS),
  overheadCents: z.number().int().min(0).max(MAX_CENTS),
  receivedCents: z.number().int().min(0).max(MAX_CENTS),
  note: z.string().trim().min(1, 'Say where the figures came from').max(1000),
});
export type ReportedPeriodInput = z.infer<typeof reportedPeriodSchema>;

async function writeSnapshotRows(
  tx: Db,
  input: {
    orgId: string;
    grantId: string;
    periodLockId: string;
    source: 'computed' | 'reported';
    released: ByClass;
    receivedCents: number;
    note: string | null;
    actor: string;
  },
) {
  const now = new Date();
  await tx.grantPeriodSnapshot.updateMany({
    where: {
      grantId: input.grantId,
      periodLockId: input.periodLockId,
      supersededAt: null,
    },
    data: { supersededAt: now },
  });
  const base = {
    orgId: input.orgId,
    grantId: input.grantId,
    periodLockId: input.periodLockId,
    source: input.source,
    note: input.note,
    actor: input.actor,
  };
  const rows = [
    ...RELEASE_CLASSES.map((cls) => ({
      ...base,
      releaseClass: cls,
      releasedCents: input.released[cls],
    })),
    { ...base, releaseClass: null, receivedCents: input.receivedCents },
  ];
  const created = await tx.grantPeriodSnapshot.createManyAndReturn({ data: rows });
  await recordAudit(tx, {
    orgId: input.orgId,
    entity: 'GrantPeriodSnapshot',
    entityId: input.periodLockId,
    action: 'create',
    after: { grantId: input.grantId, source: input.source, rows: created },
    actor: input.actor,
  });
  return created;
}

/**
 * Record a period the bookkeeper reported before the app. The period lock is
 * shared org-wide (created without a run when none matches these dates); the
 * grant's earlier rows for that period are superseded, never deleted.
 */
/** The first existing lock whose range shares a day with [from, to], if any. */
export async function findOverlappingLock(
  tx: Prisma.TransactionClient,
  orgId: string,
  from: Date,
  to: Date,
  excludeId?: string,
) {
  return tx.periodLock.findFirst({
    where: {
      orgId,
      periodFrom: { lte: to },
      periodTo: { gte: from },
      ...(excludeId ? { id: { not: excludeId } } : {}),
    },
    orderBy: { periodFrom: 'asc' },
  });
}

export async function recordReportedPeriod(
  orgId: string,
  grantId: string,
  raw: ReportedPeriodInput,
  actor = 'local-user',
) {
  const input = reportedPeriodSchema.parse(raw);
  if (input.periodFrom > input.periodTo)
    throw new ValidationError({ periodTo: 'Period end must not precede its start' });
  const grant = await prisma.grant.findFirst({ where: { id: grantId, orgId } });
  if (!grant) throw new ValidationError({ _: 'Grant not found' });
  return prisma.$transaction(async (tx) => {
    let lock = await tx.periodLock.findFirst({
      where: { orgId, periodFrom: input.periodFrom, periodTo: input.periodTo },
      orderBy: { lockedAt: 'asc' },
    });
    if (!lock) {
      const overlap = await findOverlappingLock(tx, orgId, input.periodFrom, input.periodTo);
      if (overlap)
        throw new ValidationError({
          periodFrom: `Overlaps the existing period "${overlap.name}" (${overlap.periodFrom.toISOString().slice(0, 10)} → ${overlap.periodTo.toISOString().slice(0, 10)}); report that period instead`,
        });
      lock = await tx.periodLock.create({
        data: {
          orgId,
          name: input.name,
          periodFrom: input.periodFrom,
          periodTo: input.periodTo,
          note: 'Reported before the app existed (JPH-23).',
        },
      });
      await recordAudit(tx, {
        orgId,
        entity: 'PeriodLock',
        entityId: lock.id,
        action: 'create',
        after: lock,
        actor,
      });
    }
    await writeSnapshotRows(tx, {
      orgId,
      grantId,
      periodLockId: lock.id,
      source: 'reported',
      released: {
        direct: input.directCents,
        staff: input.staffCents,
        overhead: input.overheadCents,
      },
      receivedCents: input.receivedCents,
      note: input.note,
      actor,
    });
    return lock;
  });
}

/**
 * Change the note on a reported period. The figures of record never change here —
 * only the free-text context a reviewer attaches to them (JPH-23 design pass).
 */
export async function updateReportedPeriodNote(
  orgId: string,
  grantId: string,
  periodLockId: string,
  note: string,
  actor = 'local-user',
) {
  const trimmed = note.trim();
  return prisma.$transaction(async (tx) => {
    const rows = await tx.grantPeriodSnapshot.findMany({
      where: { orgId, grantId, periodLockId, source: 'reported', supersededAt: null },
    });
    if (rows.length === 0) throw new ValidationError({ _: 'No reported period to annotate' });
    await tx.grantPeriodSnapshot.updateMany({
      where: { id: { in: rows.map((r) => r.id) } },
      data: { note: trimmed || null },
    });
    await recordAudit(tx, {
      orgId,
      entity: 'GrantPeriodSnapshot',
      entityId: periodLockId,
      action: 'update',
      before: { note: rows[0]!.note },
      after: { note: trimmed || null },
      actor,
    });
  });
}

/**
 * Freeze the current-period figures of every active grant when the app locks a
 * period. Grants that already carry a snapshot for it — reported, or computed by an
 * earlier attempt — are left alone: a closed period is never recomputed.
 */
export async function snapshotLockedPeriod(orgId: string, periodLockId: string, actor = 'local-user') {
  const lock = await prisma.periodLock.findFirstOrThrow({ where: { id: periodLockId, orgId } });
  const grants = await prisma.grant.findMany({
    where: { orgId, status: { not: 'archived' }, startDate: { lte: lock.periodTo } },
    select: { id: true },
  });
  let written = 0;
  for (const g of grants) {
    const frozen = await prisma.grantPeriodSnapshot.count({
      where: { grantId: g.id, periodLockId, supersededAt: null },
    });
    if (frozen > 0) continue;
    const row = await grantRollforward(orgId, g.id, lock.periodFrom, lock.periodTo);
    await prisma.$transaction((tx) =>
      writeSnapshotRows(tx, {
        orgId,
        grantId: g.id,
        periodLockId,
        source: 'computed',
        released: row.released,
        receivedCents: row.receivedCents,
        note: null,
        actor,
      }),
    );
    written++;
  }
  return written;
}

/** Default rollforward window: the org's current fiscal year through today. */
export function defaultRollforwardRange(fiscalYearStartMonth: number, today = new Date()) {
  const y = today.getUTCFullYear();
  const m = today.getUTCMonth() + 1;
  const startYear = m >= fiscalYearStartMonth ? y : y - 1;
  const from = utcDate(startYear, fiscalYearStartMonth, 1);
  const to = utcDate(y, m, today.getUTCDate());
  return { from, to };
}
