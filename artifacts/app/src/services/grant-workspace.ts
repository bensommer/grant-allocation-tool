/**
 * Grant workspace read models (JPH-23): header metrics, the tie-out panel,
 * the activity grid and the working view. Pure arithmetic lives in
 * `@/domain/periods`; this file only assembles data from the current run.
 */
import { prisma } from '@/lib/db';
import {
  elapsedBps,
  monthsLeft,
  perMonthRemaining,
  perRemainingOccurrence,
  plannedEntryCents,
  projectedAtEnd,
  type PlannedEntry,
} from '@/domain/periods';
import type { GrantFigures } from '@/domain/grant-figures';
import { budgetTree, type BudgetLineView, type BudgetTree } from '@/services/grant-budget';
import { grantFiguresFor } from '@/services/grant-figures';
import { reviewQueue, type ReviewLine, type ReviewQueue } from '@/services/review';

// --- header metrics ------------------------------------------------------------

export interface HeaderMetrics {
  awardCents: number;
  receivedCents: number;
  /** spend through `asOf` in the grant's tracking mode (see `@/domain/grant-figures`) */
  spentCents: number;
  restrictedBalanceCents: number;
  remainingAwardCents: number;
  elapsedBps: number;
  spentBps: number;
  /** spent % − elapsed %, in whole points: negative = behind pace, positive = ahead. */
  pacePts: number;
  monthsLeft: number;
  projectedAtEndCents: number | null;
  asOf: Date;
}

/** The overview header cards, read from the grant's figures at `asOf` (JPH-30). */
export function headerMetricsOf(figures: GrantFigures): HeaderMetrics {
  return {
    awardCents: figures.awardCents,
    receivedCents: figures.receivedCents,
    spentCents: figures.spentCents,
    restrictedBalanceCents: figures.restrictedBalanceCents,
    remainingAwardCents: figures.remainingAwardCents,
    elapsedBps: figures.elapsedBps,
    spentBps: figures.spentBps,
    pacePts: figures.pacePts,
    monthsLeft: figures.monthsLeft,
    projectedAtEndCents: figures.projectedAtEndCents,
    asOf: figures.asOf,
  };
}

export async function headerMetrics(
  orgId: string,
  grant: { id: string },
  asOf: Date,
): Promise<HeaderMetrics> {
  const g = await grantFiguresFor(orgId, grant.id, asOf);
  if (!g) throw new Error('Grant not found');
  return headerMetricsOf(g.figures);
}

// --- tie-out -------------------------------------------------------------------

export interface TieOut {
  runId: string | null;
  stale: boolean;
  codedCents: number;
  assignedCents: number;
  excluded: Array<{ reason: string; count: number; cents: number }>;
  excludedCents: number;
  needsReviewCents: number;
  needsReviewCount: number;
  /** Needs-review lines that sit in a proposed reversal pair (net zero). */
  pairedCount: number;
  effortCents: number;
  chargedCents: number;
  /**
   * `clean`: nothing is waiting. `pairs`: the only lines waiting sit in proposed
   * reversal pairs that net to zero — a reviewer still has to confirm them.
   * `open`: lines are waiting that no pair explains.
   */
  status: TieOutStatus;
  /** Proposed reversal pairs with at least one line still waiting. */
  pendingPairs: number;
  /** The first few unpaired lines waiting, oldest first, for the panel. */
  waiting: ReviewLine[];
  /** Fully clean (`status === 'clean'`); a pending pair is not green. */
  green: boolean;
  /** Manual decisions active in the current run, for the rollforward note. */
  decisionGroups: Array<{ groupId: string; kind: string; note: string; cents: number }>;
}

export type TieOutStatus = 'clean' | 'pairs' | 'open';

/** How many waiting lines the panel shows inline before pointing at the queue. */
export const TIE_OUT_INLINE_LINES = 3;

export function tieOutFromQueue(queue: ReviewQueue, effortCents: number): TieOut {
  const excludedBy = new Map<string, { count: number; cents: number }>();
  for (const l of queue.excluded) {
    const key = l.reason ?? 'excluded';
    const cur = excludedBy.get(key) ?? { count: 0, cents: 0 };
    cur.count++;
    cur.cents += l.amountCents;
    excludedBy.set(key, cur);
  }
  const needsReview: ReviewLine[] = queue.groups.flatMap((g) => g.lines);
  const paired = new Set(queue.proposals.flatMap((p) => [p.positive.id, p.negative.id]));
  const pairedCount = needsReview.filter((l) => paired.has(l.id)).length;
  const waitingIds = new Set(needsReview.map((l) => l.id));
  const pendingPairs = queue.proposals.filter(
    (p) => waitingIds.has(p.positive.id) || waitingIds.has(p.negative.id),
  ).length;
  const unpaired = needsReview
    .filter((l) => !paired.has(l.id))
    .sort((a, b) => a.txnDate.getTime() - b.txnDate.getTime());
  const status: TieOutStatus =
    unpaired.length > 0 || queue.totals.needsReviewCents !== 0
      ? 'open'
      : needsReview.length > 0
        ? 'pairs'
        : 'clean';
  const decisionOf = new Map(queue.decisions.map((d) => [d.id, d]));
  const groups = new Map<string, TieOut['decisionGroups'][number]>();
  for (const l of [...queue.assigned, ...queue.excluded]) {
    const d = l.decisionId ? decisionOf.get(l.decisionId) : undefined;
    if (!d || d.supersededAt) continue;
    const g = groups.get(d.groupId) ?? { groupId: d.groupId, kind: d.kind, note: d.note, cents: 0 };
    g.cents += l.amountCents;
    groups.set(d.groupId, g);
  }
  return {
    runId: queue.runId,
    stale: queue.stale,
    codedCents: queue.totals.memberCents,
    assignedCents: queue.totals.assignedCents,
    excluded: [...excludedBy.entries()]
      .map(([reason, v]) => ({ reason, ...v }))
      .sort((a, b) => a.reason.localeCompare(b.reason)),
    excludedCents: queue.totals.excludedCents,
    needsReviewCents: queue.totals.needsReviewCents,
    needsReviewCount: needsReview.length,
    pairedCount,
    effortCents,
    chargedCents: queue.totals.assignedCents + effortCents,
    status,
    pendingPairs,
    waiting: unpaired.slice(0, TIE_OUT_INLINE_LINES),
    green: status === 'clean',
    decisionGroups: [...groups.values()],
  };
}

/** Lines waiting for review in the current run — the badge on the Review tab. */
export async function needsReviewCount(orgId: string, grantId: string): Promise<number> {
  return prisma.grantLineResult.count({
    where: {
      orgId,
      grantId,
      state: 'needs_review',
      source: 'transaction',
      run: { isCurrent: true },
    },
  });
}

export async function tieOut(orgId: string, grantId: string, tree?: BudgetTree): Promise<TieOut> {
  const [queue, t] = await Promise.all([
    reviewQueue(orgId, grantId),
    tree ?? budgetTree(orgId, grantId),
  ]);
  return tieOutFromQueue(queue, t.totals.effortCents);
}

// --- activity grid -------------------------------------------------------------

export interface GridCell {
  categoryId: string;
  budgetCents: number;
  chargedCents: number;
  remainingCents: number;
  overBudget: boolean;
  /** remaining ÷ (planned − completed); null when no occurrences remain */
  perOccurrenceCents: number | null;
}

export interface GridRow {
  activityId: string;
  name: string;
  plannedCount: number;
  completedCount: number;
  cells: GridCell[];
  totalBudgetCents: number;
  totalChargedCents: number;
  totalRemainingCents: number;
}

export interface ActivityGrid {
  columns: Array<{ id: string; code: string; name: string }>;
  rows: GridRow[];
  /** Arithmetic column sums: an over-budget cell stays on its own row and is never netted. */
  totals: Array<{
    categoryId: string;
    budgetCents: number;
    chargedCents: number;
    remainingCents: number;
  }>;
  unassignedCells: BudgetLineView[];
}

export function activityGrid(tree: BudgetTree): ActivityGrid {
  const cells = tree.all.filter((l) => l.kind === 'cell' && l.activityId);
  const columns = tree.categories.filter((c) => cells.some((l) => l.parentId === c.id));
  const rows: GridRow[] = tree.activities.map((a) => {
    const rowCells = columns.map((c) => {
      const mine = cells.filter((l) => l.activityId === a.id && l.parentId === c.id);
      const budgetCents = mine.reduce((s, l) => s + l.currentCents, 0);
      const chargedCents = mine.reduce((s, l) => s + l.chargedCents, 0);
      const remainingCents = budgetCents - chargedCents;
      return {
        categoryId: c.id,
        budgetCents,
        chargedCents,
        remainingCents,
        overBudget: remainingCents < 0,
        perOccurrenceCents: perRemainingOccurrence(
          remainingCents,
          a.plannedCount,
          a.completedCount,
        ),
      };
    });
    return {
      activityId: a.id,
      name: a.name,
      plannedCount: a.plannedCount,
      completedCount: a.completedCount,
      cells: rowCells,
      totalBudgetCents: rowCells.reduce((s, c) => s + c.budgetCents, 0),
      totalChargedCents: rowCells.reduce((s, c) => s + c.chargedCents, 0),
      totalRemainingCents: rowCells.reduce((s, c) => s + c.remainingCents, 0),
    };
  });
  const totals = columns.map((c, i) => ({
    categoryId: c.id,
    budgetCents: rows.reduce((s, r) => s + r.cells[i]!.budgetCents, 0),
    chargedCents: rows.reduce((s, r) => s + r.cells[i]!.chargedCents, 0),
    remainingCents: rows.reduce((s, r) => s + r.cells[i]!.remainingCents, 0),
  }));
  return {
    columns: columns.map((c) => ({ id: c.id, code: c.code, name: c.name })),
    rows,
    totals,
    unassignedCells: cells.filter((l) => !columns.some((c) => c.id === l.parentId)),
  };
}

// --- working view --------------------------------------------------------------

export interface WorkingRow {
  line: BudgetLineView;
  remainingCents: number;
  perMonthCents: number | null;
}

export interface WorkingView {
  months: number;
  asOf: Date;
  categories: Array<{
    category: BudgetLineView;
    rows: WorkingRow[];
    remainingCents: number;
    perMonthCents: number | null;
  }>;
  loose: WorkingRow[];
  totalRemainingCents: number;
  totalPerMonthCents: number | null;
}

export function workingView(tree: BudgetTree, grant: { endDate: Date }, asOf: Date): WorkingView {
  const months = monthsLeft(asOf, grant.endDate);
  const row = (line: BudgetLineView): WorkingRow => {
    const remainingCents = line.currentCents - line.chargedCents;
    return { line, remainingCents, perMonthCents: perMonthRemaining(remainingCents, months) };
  };
  const categories = tree.categories.map((category) => {
    const rows = category.children.map(row);
    const remainingCents = category.currentCents - category.chargedCents;
    return {
      category,
      rows,
      remainingCents,
      perMonthCents: perMonthRemaining(remainingCents, months),
    };
  });
  const loose = tree.loose.map(row);
  const totalRemainingCents = tree.totals.budgetCents - tree.totals.chargedCents;
  return {
    months,
    asOf,
    categories,
    loose,
    totalRemainingCents,
    totalPerMonthCents: perMonthRemaining(totalRemainingCents, months),
  };
}

export interface Forecast {
  to: Date;
  entries: Array<PlannedEntry & { cents: number }>;
  plannedCents: number;
  spentCents: number;
  projectedCents: number;
  remainingAfterCents: number;
}

/** Spent to date plus the planned entries = projected spend at the chosen date. */
export function forecast(
  spentCents: number,
  budgetCents: number,
  to: Date,
  entries: PlannedEntry[],
): Forecast {
  const priced = entries.map((e) => ({ ...e, cents: plannedEntryCents(e) }));
  const plannedCents = priced.reduce((s, e) => s + e.cents, 0);
  return {
    to,
    entries: priced,
    plannedCents,
    spentCents,
    projectedCents: spentCents + plannedCents,
    remainingAfterCents: budgetCents - spentCents - plannedCents,
  };
}

/** Grant header fields the workspace pages share. */
export async function grantHeader(orgId: string, id: string) {
  return prisma.grant.findFirst({
    where: { id, orgId },
    select: {
      id: true,
      name: true,
      funder: true,
      startDate: true,
      endDate: true,
      awardAmountCents: true,
      status: true,
    },
  });
}

/** Notes for a rollforward column: decisions behind its figures and coded amounts still waiting. */
export async function rollforwardNotes(
  orgId: string,
  grantId: string,
): Promise<Array<{ text: string; href: string }>> {
  const t = await tieOut(orgId, grantId);
  const href = `/grants/${grantId}/review`;
  const notes = t.decisionGroups.map((g) => ({
    text: `${g.kind === 'exclude' ? 'Excluded' : 'Assigned'} by decision: ${g.note}`,
    href: `${href}#decision-${g.groupId}`,
  }));
  // A pending reversal pair nets to zero and does not move the released figure, so only
  // lines no pair explains earn a note.
  if (t.status === 'open')
    notes.push({
      text: `Coded to the grant but not yet released: needs review (${t.needsReviewCount} line${t.needsReviewCount === 1 ? '' : 's'}).`,
      href,
    });
  return notes;
}
