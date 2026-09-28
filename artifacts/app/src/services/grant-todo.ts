/**
 * The grant's "To do" tab and the Status tab's "what's next" line (JPH-29 E1).
 *
 * Close status is an org-wide calculation (`src/domain/close-status.ts`); the per-grant view
 * is the same pure function fed the org input filtered to this grant, so a grant's next step
 * is always consistent with the close checklist on `/`.
 */
import {
  closeStatus,
  type CloseInput,
  type CloseStatus,
  type CloseStep,
} from '@/domain/close-status';
import type { CurrentPeriod } from '@/lib/period';
import { prisma } from '@/lib/db';
import { loadCloseStatus } from '@/services/close-status';
import { listDrafts } from '@/services/correcting-entries';
import { effortSummary, type EffortScheduleView } from '@/services/effort';
import { budgetTree } from '@/services/grant-budget';
import { grantReviewQueue, type GrantQueue } from '@/services/review-queue';

export interface GrantTodo {
  review: GrantQueue;
  /** Active schedules with a variance to settle (booked payroll ≠ planned charges). */
  effortOpen: EffortScheduleView[];
  effortAll: EffortScheduleView[];
  /** Correcting entries drafted but not yet posted in QuickBooks. */
  drafts: Awaited<ReturnType<typeof listDrafts>>;
  /**
   * Transactions waiting for a decision (proposed reversal pairs are not transactions of
   * their own) + effort variances + drafts to post: the To do tab badge.
   */
  openCount: number;
  status: CloseStatus;
  /** The first step that is not green for this grant, or null when everything is done. */
  next: CloseStep | null;
}

/** Filter the org-wide close input down to one grant. */
export function grantCloseInput(
  input: CloseInput,
  grantId: string,
  review: GrantQueue,
): CloseInput {
  return {
    ...input,
    review: {
      count: review.totalCents !== 0 ? review.count : 0,
      totalCents: review.totalCents,
      pairs: review.totalCents === 0 ? review.count : 0,
    },
    flaggedGrants: input.flaggedGrants.filter((g) => g.id === grantId),
    // Health checks are about the books as a whole, not this grant.
    healthWarnings: [],
    effort: input.effort.filter((e) => e.grantId === grantId),
    drafts: input.drafts.filter((d) => d.grantId === grantId),
  };
}

export async function grantTodo(
  orgId: string,
  grantId: string,
  period: CurrentPeriod,
): Promise<GrantTodo> {
  const [review, effort, drafts, close] = await Promise.all([
    grantReviewQueue(orgId, grantId),
    effortSummary(orgId, grantId, period.date),
    listDrafts(orgId, grantId),
    loadCloseStatus(orgId, period),
  ]);
  if (!review) throw new Error(`Grant ${grantId} not found`);
  const effortOpen = effort.schedules.filter((s) => s.active && s.varianceCents !== 0);
  const toPost = drafts.filter((d) => d.status === 'drafted');
  const status = closeStatus(grantCloseInput(close.input, grantId, review));
  // Proposed reversal pairs net to zero and are confirmed, not decided; they are not counted.
  const openCount = review.count - review.pairCount + effortOpen.length + toPost.length;
  return {
    review,
    effortOpen,
    effortAll: effort.schedules,
    drafts: toPost,
    openCount,
    status,
    next: status.steps.find((s) => s.key === status.open) ?? null,
  };
}

/**
 * Setup-tab attention dot (E1): the working lines do not add up to the funder budget, or a
 * membership-tracked grant has no rules yet.
 */
export async function setupNeedsAttention(
  orgId: string,
  grantId: string,
  mode: 'membership' | 'crosswalk' | null,
): Promise<{ dot: boolean; differenceCents: number; ruleCount: number }> {
  const [tree, ruleCount] = await Promise.all([
    budgetTree(orgId, grantId),
    prisma.crosswalkRule.count({ where: { orgId, grantId, active: true } }),
  ]);
  const differenceCents =
    tree.categories.length > 0 ? tree.totals.workingCurrentCents - tree.totals.funderCents : 0;
  const dot = differenceCents !== 0 || (mode === 'membership' && ruleCount === 0);
  return { dot, differenceCents, ruleCount };
}
