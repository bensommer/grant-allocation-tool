/**
 * One set of grant figures (JPH-30).
 *
 * Every page that shows a grant's spent / received / restricted balance /
 * remaining / pacing / released gets them from `grantFigures`, and the result
 * states which tracking mode produced them:
 *
 * - `membership`: spend is the current run's assigned member lines
 *   (GrantLineResult) plus effort charges — what the pilot pages compute.
 * - `crosswalk`: spend is the current run's crosswalk pieces (AllocatedLine)
 *   mapped to the grant's budget lines — what the BvA report computes.
 *
 * This module is pure over already-loaded data; `@/services/grant-figures`
 * loads the pieces for each mode. Everything is integer cents.
 */
import { pacing, isOverBudget } from '@/domain/pacing';
import { matchesReceived, type RevenueMatcher } from '@/domain/received';
import {
  addByClass,
  elapsedBps,
  monthsLeft,
  projectedAtEnd,
  zeroByClass,
  type ByClass,
  type ReleaseClass,
} from '@/domain/periods';

export type TrackingMode = 'crosswalk' | 'membership';
export type Pace = ReturnType<typeof pacing>;

// --- tracking mode -------------------------------------------------------------

export interface TrackingSignals {
  /** The stored column; `crosswalk` is the default and may predate the backfill. */
  trackingMode?: TrackingMode | null;
  memberClassIds: string[];
  memberPartyIds: string[];
  membershipCount: number;
  scopedImportCount: number;
  /** Report uploads that were actually imported (a staged or abandoned upload is no signal). */
  importedUploadCount: number;
}

/**
 * A grant with any member lines, member classes / projects, or a QuickBooks report
 * import scoped to it is tracked by membership; otherwise by crosswalk rules. The
 * stored column wins once it says `membership`, so a backfilled grant stays put
 * even if its member rows are later superseded.
 */
export function deriveTrackingMode(s: TrackingSignals): TrackingMode {
  if (s.trackingMode === 'membership') return 'membership';
  return s.memberClassIds.length > 0 ||
    s.memberPartyIds.length > 0 ||
    s.membershipCount > 0 ||
    s.scopedImportCount > 0 ||
    s.importedUploadCount > 0
    ? 'membership'
    : 'crosswalk';
}

export interface TrackingNames {
  qboClassName: string | null;
  qboProjectName: string | null;
  /** Resolved names of memberClassIds / memberPartyIds, when the ledger has the rows. */
  memberClassNames?: string[];
  memberProjectNames?: string[];
}

export const CROSSWALK_LABEL = 'Tracked by crosswalk rules';

/** The read-only badge on the grant header. */
export function trackingLabel(mode: TrackingMode, names: TrackingNames): string {
  if (mode === 'crosswalk') return CROSSWALK_LABEL;
  const cls = names.qboClassName ?? names.memberClassNames?.[0];
  if (cls) return `Tracked by QuickBooks class: ${cls}`;
  const project = names.qboProjectName ?? names.memberProjectNames?.[0];
  if (project) return `Tracked by QuickBooks project: ${project}`;
  return 'Tracked by QuickBooks member lines';
}

// --- inputs --------------------------------------------------------------------

export interface FigureLine {
  id: string;
  code: string;
  name: string;
  kind: 'funder_category' | 'working_line' | 'cell';
  parentId: string | null;
  programId: string | null;
  releaseClass: ReleaseClass;
  /** Current budget (original plus revisions). */
  budgetCents: number;
  sortOrder: number;
}

/** One unit of spend before any date filter: a crosswalk piece, a member line or an effort charge. */
export interface SpendPiece {
  budgetLineId: string | null;
  amountCents: number;
  /** Effort charges carry no date and always count in full. */
  txnDate: Date | null;
  source: 'transaction' | 'effort';
}

export interface ReceiptLine {
  id: string;
  amountCents: number;
  txnDate: Date;
  accountId: string;
  accountType: string;
  classId: string | null;
  transactionPartyId: string | null;
  linePartyId: string | null;
  /** A member income line of this grant (scoped export) counts without a matcher. */
  member: boolean;
}

export interface FiguresGrant extends RevenueMatcher {
  awardAmountCents: number;
  startDate: Date;
  endDate: Date;
  restrictionType: 'purpose' | 'time' | 'unrestricted' | string;
}

/**
 * The review queue of one grant in the current run: every waiting transaction line, its total,
 * and how many of those lines sit in a proposed reversal pair (JPH-27 C5).
 */
export interface NeedsReview {
  count: number;
  cents: number;
  /** Waiting lines that are one half of an equal-and-opposite proposal; 0 when unknown. */
  pairedCount?: number;
}

/**
 * Transactions a reviewer still has to decide on: the waiting lines minus the ones a proposed
 * reversal pair already accounts for (the queue shows a pair as one row with "Confirm pair").
 * This is the sidebar badge and the grant-header chip (JPH-27 C5).
 */
export function toReviewCount(needsReview: NeedsReview): number {
  return Math.max(0, needsReview.count - (needsReview.pairedCount ?? 0));
}

export interface FiguresInput {
  mode: TrackingMode;
  grant: FiguresGrant;
  asOf: Date;
  lines: FigureLine[];
  /** Spend pieces of the mode's source, unfiltered by date. */
  pieces: SpendPiece[];
  /** Income lines of the org, unfiltered by date. */
  receipts: ReceiptLine[];
  /** Lines waiting in the review queue (membership only; zero for crosswalk). */
  needsReview: NeedsReview;
  thresholds: { underPercent: number; overPercent: number };
}

// --- outputs -------------------------------------------------------------------

export interface LineFigures {
  id: string;
  code: string;
  name: string;
  kind: FigureLine['kind'];
  parentId: string | null;
  programId: string | null;
  releaseClass: ReleaseClass;
  budgetCents: number;
  /** Dated spend (crosswalk pieces or member lines). */
  spentCents: number;
  /** Effort charges (membership only). */
  effortCents: number;
  /** spent + effort */
  chargedCents: number;
  remainingCents: number;
  overBudget: boolean;
  /** Dated spend by YYYY-MM. */
  monthly: Record<string, number>;
}

export interface GrantFigures {
  mode: TrackingMode;
  asOf: Date;
  awardCents: number;
  receivedCents: number;
  /** The income lines behind `receivedCents`, oldest first. */
  receiptLines: ReceiptLine[];
  /** All spend through `asOf`: dated pieces in the window plus effort charges. */
  spentCents: number;
  /** received − spent */
  restrictedBalanceCents: number;
  /** award − spent */
  remainingAwardCents: number;
  /** Straight-line share of the award expected through `asOf`. */
  expectedCents: number;
  pacing: Pace;
  spentByBudgetLine: LineFigures[];
  /** Σ current budget of the lines (leaves). */
  budgetCents: number;
  releasedByClass: ByClass;
  needsReviewCents: number;
  needsReviewCount: number;
  /** Waiting transactions net of proposed reversal pairs — the "N to review" chip and badge. */
  toReviewCount: number;
  effortCents: number;
  /** Outside the pacing thresholds (restricted grants) or a line over budget. */
  flagged: boolean;
  /** Straight-line pacing applies: restricted grants only. Unrestricted gifts are never "behind". */
  paced: boolean;
  // header-card fields
  elapsedBps: number;
  spentBps: number;
  /** spent % − elapsed %, in whole points: negative = behind pace, positive = ahead. */
  pacePts: number;
  monthsLeft: number;
  projectedAtEndCents: number | null;
}

// --- windows -------------------------------------------------------------------

export interface DateWindow {
  from?: Date;
  to?: Date;
}

const inWindow = (d: Date, w: DateWindow) =>
  (w.from === undefined || d >= w.from) && (w.to === undefined || d <= w.to);

/**
 * Dated spend that can ever count for the grant. Crosswalk pieces count only inside
 * the grant period (the BvA rule); member lines count whenever they are dated.
 */
export function eligibleWindow(mode: TrackingMode, grant: { startDate: Date; endDate: Date }) {
  return mode === 'crosswalk' ? { from: grant.startDate, to: grant.endDate } : {};
}

function withinWindows(d: Date | null, windows: DateWindow[]): boolean {
  if (d === null) return true; // undated effort charges always count
  return windows.every((w) => inWindow(d, w));
}

/** Released by class for dated pieces within `range` (effort excluded), for the rollforward. */
export function bookedByClass(
  mode: TrackingMode,
  grant: { startDate: Date; endDate: Date },
  lines: readonly FigureLine[],
  pieces: readonly SpendPiece[],
  range: DateWindow,
): ByClass {
  const cls = releaseClassOf(lines);
  const out = zeroByClass();
  const eligible = eligibleWindow(mode, grant);
  for (const p of pieces) {
    if (p.source !== 'transaction' || p.txnDate === null) continue;
    if (!inWindow(p.txnDate, eligible) || !inWindow(p.txnDate, range)) continue;
    out[cls(p, 'direct')] += p.amountCents;
  }
  return out;
}

/** Effort charges by class (undated; membership only). */
export function effortByClass(
  lines: readonly FigureLine[],
  pieces: readonly SpendPiece[],
): ByClass {
  const cls = releaseClassOf(lines);
  const out = zeroByClass();
  for (const p of pieces) if (p.source === 'effort') out[cls(p, 'staff')] += p.amountCents;
  return out;
}

function releaseClassOf(lines: readonly FigureLine[]) {
  const byId = new Map(lines.map((l) => [l.id, l.releaseClass]));
  return (p: SpendPiece, fallback: ReleaseClass): ReleaseClass =>
    (p.budgetLineId ? byId.get(p.budgetLineId) : undefined) ?? fallback;
}

/**
 * The income lines that count as grant income within `range`: member income lines
 * plus lines the grant's revenue matchers pick up, each once, oldest first.
 * Crosswalk grants clip to the grant period.
 */
export function receiptsIn(
  mode: TrackingMode,
  grant: FiguresGrant,
  receipts: readonly ReceiptLine[],
  range: DateWindow,
): ReceiptLine[] {
  const eligible = eligibleWindow(mode, grant);
  return receipts.filter(
    (r) =>
      inWindow(r.txnDate, eligible) &&
      inWindow(r.txnDate, range) &&
      (r.member || matchesReceived(grant, r)),
  );
}

/** Σ `receiptsIn`. */
export function receivedIn(
  mode: TrackingMode,
  grant: FiguresGrant,
  receipts: readonly ReceiptLine[],
  range: DateWindow,
): number {
  return receiptsIn(mode, grant, receipts, range).reduce((n, r) => n + r.amountCents, 0);
}

// --- the figures ---------------------------------------------------------------

export function grantFigures(input: FiguresInput): GrantFigures {
  const { mode, grant, asOf, lines, pieces, receipts, thresholds } = input;
  const windows: DateWindow[] = [eligibleWindow(mode, grant), { to: asOf }];
  const counted = pieces.filter((p) => withinWindows(p.txnDate, windows));

  const perLine = new Map<
    string,
    { spent: number; effort: number; monthly: Record<string, number> }
  >();
  const bucket = (id: string) => {
    let b = perLine.get(id);
    if (!b) perLine.set(id, (b = { spent: 0, effort: 0, monthly: {} }));
    return b;
  };
  let spentCents = 0;
  let effortCents = 0;
  for (const p of counted) {
    if (p.source === 'effort') effortCents += p.amountCents;
    else spentCents += p.amountCents;
    if (!p.budgetLineId) continue;
    const b = bucket(p.budgetLineId);
    if (p.source === 'effort') b.effort += p.amountCents;
    else {
      b.spent += p.amountCents;
      const month = p.txnDate!.toISOString().slice(0, 7);
      b.monthly[month] = (b.monthly[month] ?? 0) + p.amountCents;
    }
  }
  const spentByBudgetLine: LineFigures[] = lines.map((l) => {
    const b = perLine.get(l.id) ?? { spent: 0, effort: 0, monthly: {} };
    const charged = b.spent + b.effort;
    return {
      id: l.id,
      code: l.code,
      name: l.name,
      kind: l.kind,
      parentId: l.parentId,
      programId: l.programId,
      releaseClass: l.releaseClass,
      budgetCents: l.budgetCents,
      spentCents: b.spent,
      effortCents: b.effort,
      chargedCents: charged,
      remainingCents: l.budgetCents - charged,
      overBudget: isOverBudget(charged, l.budgetCents),
      monthly: b.monthly,
    };
  });
  const totalSpent = spentCents + effortCents;
  const receiptLines = receiptsIn(mode, grant, receipts, { to: asOf });
  const receivedCents = receiptLines.reduce((n, r) => n + r.amountCents, 0);
  const pace = pacing(
    grant.awardAmountCents,
    totalSpent,
    grant.startDate,
    grant.endDate,
    asOf,
    thresholds.underPercent,
    thresholds.overPercent,
  );
  const elapsed = elapsedBps(grant.startDate, grant.endDate, asOf);
  const spentBps =
    grant.awardAmountCents > 0 ? Math.round((totalSpent / grant.awardAmountCents) * 10000) : 0;
  const leaves = spentByBudgetLine.filter((l) => l.kind !== 'funder_category');
  const needsReview = mode === 'membership' ? input.needsReview : { count: 0, cents: 0 };
  return {
    mode,
    asOf,
    awardCents: grant.awardAmountCents,
    receivedCents,
    receiptLines,
    spentCents: totalSpent,
    restrictedBalanceCents: receivedCents - totalSpent,
    remainingAwardCents: grant.awardAmountCents - totalSpent,
    expectedCents: pace.expectedCents,
    pacing: pace,
    spentByBudgetLine,
    budgetCents: leaves.reduce((n, l) => n + l.budgetCents, 0),
    releasedByClass: addByClass(
      bookedByClass(mode, grant, lines, pieces, { to: asOf }),
      effortByClass(lines, pieces),
    ),
    needsReviewCents: needsReview.cents,
    needsReviewCount: needsReview.count,
    toReviewCount: toReviewCount(needsReview),
    effortCents,
    flagged:
      (grant.restrictionType !== 'unrestricted' && pace.flag !== 'on pace') ||
      leaves.some((l) => l.overBudget),
    paced: grant.restrictionType !== 'unrestricted',
    elapsedBps: elapsed,
    spentBps,
    pacePts: Math.round(spentBps / 100) - Math.round(elapsed / 100),
    monthsLeft: monthsLeft(asOf, grant.endDate),
    projectedAtEndCents: projectedAtEnd(totalSpent, grant.startDate, grant.endDate, asOf),
  };
}
