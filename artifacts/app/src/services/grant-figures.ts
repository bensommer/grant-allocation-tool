/**
 * Loads what `@/domain/grant-figures` needs for each tracking mode (JPH-30).
 *
 * This is the only place that reads spend for a grant: crosswalk pieces
 * (AllocatedLine) for crosswalk grants, assigned member lines and effort
 * charges (GrantLineResult) for membership grants, income lines for both. The
 * arithmetic — windows, pacing, balances, released by class — is in the domain
 * module; nothing here adds cents up.
 */
import type { Grant, GrantBudgetLine } from '@/generated/prisma/client';
import { prisma } from '@/lib/db';
import {
  deriveTrackingMode,
  grantFigures,
  trackingLabel,
  type FigureLine,
  type GrantFigures,
  type ReceiptLine,
  type SpendPiece,
  type TrackingMode,
} from '@/domain/grant-figures';
import { getPacingSettings } from '@/services/settings';

const EXPENSE_TYPES = ['Expense', 'COGS', 'OtherExpense'] as const;
const INCOME_TYPES = ['Income', 'OtherIncome'] as const;

// --- books-through -------------------------------------------------------------

export async function lastImportedTransactionDate(orgId: string): Promise<Date | null> {
  const result = await prisma.transaction.aggregate({
    where: { orgId, deletedAt: null },
    _max: { txnDate: true },
  });
  return result._max.txnDate;
}

/** The date figures read through when a page names none: the last imported transaction. */
export async function booksThrough(orgId: string): Promise<Date> {
  return (await lastImportedTransactionDate(orgId)) ?? new Date();
}

// --- tracking mode -------------------------------------------------------------

export interface GrantTracking {
  mode: TrackingMode;
  /** "Tracked by QuickBooks class: …" / "… project: …" / "Tracked by crosswalk rules" */
  label: string;
}

type TrackedGrant = Pick<
  Grant,
  'id' | 'trackingMode' | 'memberClassIds' | 'memberPartyIds' | 'qboClassName' | 'qboProjectName'
> & { _count: { memberships: number; scopedImports: number; reportUploads: number } };

const trackingInclude = {
  _count: {
    select: {
      memberships: { where: { supersededAt: null } },
      scopedImports: true,
      // Only uploads that went through import; staging a report must not flip the mode.
      reportUploads: { where: { batchId: { not: null } } },
    },
  },
} as const;

function modeOf(g: TrackedGrant): TrackingMode {
  return deriveTrackingMode({
    trackingMode: g.trackingMode,
    memberClassIds: g.memberClassIds,
    memberPartyIds: g.memberPartyIds,
    membershipCount: g._count.memberships,
    scopedImportCount: g._count.scopedImports,
    importedUploadCount: g._count.reportUploads,
  });
}

async function labelOf(orgId: string, g: TrackedGrant, mode: TrackingMode): Promise<string> {
  if (mode === 'crosswalk' || g.qboClassName || g.qboProjectName) return trackingLabel(mode, g);
  const [classes, parties] = await Promise.all([
    g.memberClassIds.length
      ? prisma.trackingClass.findMany({
          where: { orgId, id: { in: g.memberClassIds } },
          select: { name: true },
        })
      : [],
    g.memberPartyIds.length
      ? prisma.party.findMany({
          where: { orgId, id: { in: g.memberPartyIds } },
          select: { displayName: true },
        })
      : [],
  ]);
  return trackingLabel(mode, {
    ...g,
    memberClassNames: classes.map((c) => c.name),
    memberProjectNames: parties.map((p) => p.displayName),
  });
}

/** Tracking mode and badge text for one grant; null when the grant is not in the org. */
export async function grantTracking(orgId: string, grantId: string): Promise<GrantTracking | null> {
  const g = await prisma.grant.findFirst({
    where: { id: grantId, orgId },
    include: trackingInclude,
  });
  if (!g) return null;
  const mode = modeOf(g);
  return { mode, label: await labelOf(orgId, g, mode) };
}

// --- loading -------------------------------------------------------------------

export interface LoadedGrant {
  grant: Grant & { budgetLines: GrantBudgetLine[] };
  mode: TrackingMode;
  runId: string | null;
  lines: FigureLine[];
  pieces: SpendPiece[];
  receipts: ReceiptLine[];
  needsReview: { count: number; cents: number };
}

export interface LoadOptions {
  /** One grant, or every non-archived grant of the org. */
  grantId?: string;
  /** Upper bound for the dated rows fetched; the domain filters again per as-of. */
  through: Date;
}

/**
 * Everything the figures need for the grants selected, loaded once per mode:
 * budget lines with revisions folded in, spend pieces of the mode's source, income
 * lines (with member flags) and the review-queue totals for membership grants.
 */
export async function loadGrants(orgId: string, opts: LoadOptions): Promise<LoadedGrant[]> {
  const [run, grants] = await Promise.all([
    prisma.computeRun.findFirst({ where: { orgId, isCurrent: true }, select: { id: true } }),
    prisma.grant.findMany({
      where: {
        orgId,
        ...(opts.grantId ? { id: opts.grantId } : { status: { not: 'archived' as const } }),
      },
      include: {
        budgetLines: { orderBy: [{ sortOrder: 'asc' }, { code: 'asc' }] },
        revisions: { select: { budgetLineId: true, counterpartLineId: true, deltaCents: true } },
        ...trackingInclude,
      },
      orderBy: { name: 'asc' },
    }),
  ]);
  const modes = new Map(grants.map((g) => [g.id, modeOf(g)]));
  const crosswalkIds = grants.filter((g) => modes.get(g.id) === 'crosswalk').map((g) => g.id);
  const membershipIds = grants.filter((g) => modes.get(g.id) === 'membership').map((g) => g.id);
  const lineGrant = new Map(grants.flatMap((g) => g.budgetLines.map((l) => [l.id, g.id] as const)));

  const [crosswalkPieces, memberPieces, receipts, needsReview] = await Promise.all([
    run && crosswalkIds.length
      ? prisma.allocatedLine.findMany({
          where: {
            orgId,
            computeRunId: run.id,
            status: 'ok',
            grantBudgetLine: { grantId: { in: crosswalkIds } },
            sourceLine: {
              account: { type: { in: [...EXPENSE_TYPES] } },
              transaction: { orgId, deletedAt: null, txnDate: { lte: opts.through } },
            },
          },
          select: {
            grantBudgetLineId: true,
            amountCents: true,
            sourceLine: { select: { transaction: { select: { txnDate: true } } } },
          },
        })
      : [],
    run && membershipIds.length
      ? prisma.grantLineResult.findMany({
          where: {
            computeRunId: run.id,
            grantId: { in: membershipIds },
            state: 'assigned',
            OR: [
              {
                source: 'transaction',
                budgetLineId: { not: null },
                line: { transaction: { txnDate: { lte: opts.through } } },
              },
              { source: 'effort' },
            ],
          },
          select: {
            grantId: true,
            budgetLineId: true,
            amountCents: true,
            source: true,
            line: { select: { transaction: { select: { txnDate: true } } } },
          },
        })
      : [],
    prisma.transactionLine.findMany({
      where: {
        orgId,
        deletedAt: null,
        account: { type: { in: [...INCOME_TYPES] } },
        transaction: { orgId, deletedAt: null, txnDate: { lte: opts.through } },
      },
      select: {
        id: true,
        accountId: true,
        classId: true,
        partyId: true,
        amountCents: true,
        account: { select: { type: true } },
        transaction: { select: { txnDate: true, partyId: true } },
        memberships: membershipIds.length
          ? {
              where: { grantId: { in: membershipIds }, supersededAt: null },
              select: { grantId: true },
            }
          : false,
      },
      orderBy: [{ transaction: { txnDate: 'asc' } }, { id: 'asc' }],
    }),
    run && membershipIds.length
      ? prisma.grantLineResult.groupBy({
          by: ['grantId'],
          _count: { _all: true },
          _sum: { amountCents: true },
          where: {
            computeRunId: run.id,
            grantId: { in: membershipIds },
            state: 'needs_review',
            source: 'transaction',
          },
        })
      : [],
  ]);

  const piecesByGrant = new Map<string, SpendPiece[]>();
  const push = (grantId: string | undefined, p: SpendPiece) => {
    if (!grantId) return;
    const arr = piecesByGrant.get(grantId);
    if (arr) arr.push(p);
    else piecesByGrant.set(grantId, [p]);
  };
  for (const p of crosswalkPieces)
    push(lineGrant.get(p.grantBudgetLineId!), {
      budgetLineId: p.grantBudgetLineId,
      amountCents: p.amountCents,
      txnDate: p.sourceLine.transaction.txnDate,
      source: 'transaction',
    });
  for (const r of memberPieces)
    push(r.grantId, {
      budgetLineId: r.budgetLineId,
      amountCents: r.amountCents,
      txnDate: r.source === 'effort' ? null : (r.line?.transaction.txnDate ?? null),
      source: r.source,
    });
  const reviewByGrant = new Map(
    needsReview.map((r) => [r.grantId, { count: r._count._all, cents: r._sum.amountCents ?? 0 }]),
  );

  return grants.map((g) => {
    const delta = new Map<string, number>();
    for (const r of g.revisions) {
      delta.set(r.budgetLineId, (delta.get(r.budgetLineId) ?? 0) + r.deltaCents);
      if (r.counterpartLineId)
        delta.set(r.counterpartLineId, (delta.get(r.counterpartLineId) ?? 0) - r.deltaCents);
    }
    const { revisions: _revisions, _count, ...grant } = g;
    void _revisions;
    void _count;
    return {
      grant,
      mode: modes.get(g.id)!,
      runId: run?.id ?? null,
      lines: g.budgetLines.map((l) => ({
        id: l.id,
        code: l.code,
        name: l.name,
        kind: l.kind,
        parentId: l.parentId,
        programId: l.programId,
        releaseClass: l.releaseClass,
        budgetCents: l.budgetCents + (delta.get(l.id) ?? 0),
        sortOrder: l.sortOrder,
      })),
      pieces: piecesByGrant.get(g.id) ?? [],
      receipts: receipts.map((r) => ({
        id: r.id,
        amountCents: r.amountCents,
        txnDate: r.transaction.txnDate,
        accountId: r.accountId,
        accountType: r.account.type,
        classId: r.classId,
        transactionPartyId: r.transaction.partyId,
        linePartyId: r.partyId,
        member: Array.isArray(r.memberships) && r.memberships.some((m) => m.grantId === g.id),
      })),
      needsReview: reviewByGrant.get(g.id) ?? { count: 0, cents: 0 },
    };
  });
}

export async function loadGrant(orgId: string, grantId: string, through: Date) {
  const [loaded] = await loadGrants(orgId, { grantId, through });
  return loaded ?? null;
}

// --- figures -------------------------------------------------------------------

export interface GrantWithFigures extends LoadedGrant {
  figures: GrantFigures;
}

/** Figures at `asOf` from an already-loaded grant (loaded through at least `asOf`). */
export function figuresOf(
  loaded: LoadedGrant,
  asOf: Date,
  thresholds: { underPercent: number; overPercent: number },
): GrantFigures {
  return grantFigures({
    mode: loaded.mode,
    grant: loaded.grant,
    asOf,
    lines: loaded.lines,
    pieces: loaded.pieces,
    receipts: loaded.receipts,
    needsReview: loaded.needsReview,
    thresholds,
  });
}

/** Figures at `asOf` for one grant or every non-archived grant, name order. */
export async function allGrantFigures(
  orgId: string,
  asOf: Date,
  grantId?: string,
): Promise<GrantWithFigures[]> {
  const [loaded, thresholds] = await Promise.all([
    loadGrants(orgId, { grantId, through: asOf }),
    getPacingSettings(orgId),
  ]);
  return loaded.map((l) => ({ ...l, figures: figuresOf(l, asOf, thresholds) }));
}

/** Figures at `asOf` for one grant; null when it is not in the org. */
export async function grantFiguresFor(
  orgId: string,
  grantId: string,
  asOf: Date,
): Promise<GrantWithFigures | null> {
  const [g] = await allGrantFigures(orgId, asOf, grantId);
  return g ?? null;
}
