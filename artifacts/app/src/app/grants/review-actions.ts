'use server';

/**
 * Row and bulk actions of the "For Review" queue (JPH-27 C3/C4). Every action is a plain form
 * POST that records `LineDecision`s through `recordDecision` and returns to the queue it came
 * from (`/grants/[id]/review` or the cross-grant `/review`); nothing here needs JavaScript.
 *
 * Bulk forms carry `grantId:lineId` pairs so the cross-grant page can post rows of several grants
 * in one submit; each grant gets its own decision group.
 */
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { bool, list, redirectWithErrors, str } from '@/lib/forms';
import { recalculateAfter } from '@/lib/after-mutation';
import { getOrgId } from '@/lib/org';
import { safeReturnPath } from '@/lib/return-path';
import { budgetTree } from '@/services/grant-budget';
import {
  DestinationUnsetError,
  GrantCodingUnsetError,
  draftReclassForDecisionGroup,
} from '@/services/correcting-entries';
import { REVERSAL_PAIR_REASON, recordDecision } from '@/services/line-decisions';
import { ValidationError } from '@/services/programs';
import type { Suggestion } from '@/domain/suggest';
import { EXCLUDE_REASONS, grantReviewQueue } from '@/services/review-queue';

function back(formData: FormData, grantId: string): string {
  return safeReturnPath(str(formData, 'returnTo'), `/grants/${grantId}/review`);
}

function done(path: string, params: Record<string, string> = {}): never {
  // The redirect lands on the page the form came from; without this the root layout (header
  // chip, sidebar badge) is not re-rendered on the client.
  revalidatePath('/', 'layout');
  const q = new URLSearchParams({ saved: '1', ...params });
  redirect(`${path}?${q.toString()}`);
}

/** `grantId:lineId` checkbox values grouped by grant, in submit order. */
function selectedByGrant(formData: FormData): Map<string, string[]> {
  const out = new Map<string, string[]>();
  for (const v of list(formData, 'rows')) {
    const i = v.indexOf(':');
    if (i <= 0) continue;
    const grantId = v.slice(0, i);
    out.set(grantId, [...(out.get(grantId) ?? []), v.slice(i + 1)]);
  }
  return out;
}

/** `grantId:targetId` group checkboxes (the no-JS form of "select all suggested → target"). */
/**
 * Ticked group headers: `grantId:targetId:lineId,lineId,…` — the rows the header stood for when
 * the page was rendered (filters applied), checked again below against the current queue.
 */
function selectedGroups(
  formData: FormData,
): Map<string, Array<{ targetId: string; lineIds: Set<string> }>> {
  const out = new Map<string, Array<{ targetId: string; lineIds: Set<string> }>>();
  for (const v of list(formData, 'groups')) {
    const [grantId, targetId, ids] = v.split(':');
    if (!grantId || !targetId) continue;
    const lineIds = new Set((ids ?? '').split(',').filter(Boolean));
    out.set(grantId, [...(out.get(grantId) ?? []), { targetId, lineIds }]);
  }
  return out;
}

/** Drafts the D1-B correcting entry for an exclusion group; a blocked draft only reports why. */
async function draftAfterExclude(
  orgId: string,
  grantId: string,
  groupId: string,
  path: string,
  extra: Record<string, string> = {},
): Promise<never> {
  try {
    const draft = await draftReclassForDecisionGroup(orgId, grantId, groupId);
    done(path, { ...extra, drafted: draft.code });
  } catch (e) {
    if (e instanceof DestinationUnsetError) done(path, { ...extra, blocked: '1' });
    if (e instanceof GrantCodingUnsetError) done(path, { ...extra, blocked: 'grant' });
    if (e instanceof ValidationError)
      done(path, { ...extra, draftError: Object.values(e.fieldErrors).join('; ') });
    throw e;
  }
}

/** Accept: assign one transaction to its suggested target; the note is the suggestion's reason. */
export async function acceptSuggestionAction(formData: FormData): Promise<void> {
  const grantId = str(formData, 'grantId');
  const path = back(formData, grantId);
  const orgId = await getOrgId();
  try {
    await recordDecision(orgId, grantId, {
      kind: 'assign',
      lineIds: [str(formData, 'lineId')],
      targetBudgetLineId: str(formData, 'targetBudgetLineId') || null,
      reason: null,
      note: str(formData, 'reason') || 'Accepted suggestion',
    });
  } catch (e) {
    if (e instanceof ValidationError) redirectWithErrors(path, e.fieldErrors, formData);
    throw e;
  }
  await recalculateAfter(orgId, 'suggestion accepted');
  done(path);
}

/** Resolves the Change form's target: a budget line id, or an activity × category pair. */
async function resolveTarget(
  orgId: string,
  grantId: string,
  formData: FormData,
): Promise<{ id: string; label: string } | { error: Record<string, string> }> {
  const tree = await budgetTree(orgId, grantId);
  const direct = str(formData, 'targetBudgetLineId');
  const activityId = str(formData, 'activityId');
  const categoryKey = str(formData, 'categoryKey');
  const activityName = new Map(tree.activities.map((a) => [a.id, a.name]));
  const label = (l: (typeof tree.all)[number]) =>
    l.kind === 'cell'
      ? `${activityName.get(l.activityId ?? '') ?? '?'} / ${l.categoryKey}`
      : l.name;
  if (direct) {
    const line = tree.all.find((l) => l.id === direct && l.kind !== 'funder_category');
    return line ? { id: line.id, label: label(line) } : { error: { targetBudgetLineId: 'Pick a working line' } };
  }
  if (activityId && categoryKey) {
    const cell = tree.all.find(
      (l) => l.kind === 'cell' && l.activityId === activityId && l.categoryKey === categoryKey,
    );
    return cell
      ? { id: cell.id, label: label(cell) }
      : { error: { categoryKey: 'That activity has no budget for that category' } };
  }
  return {
    error: activityId || categoryKey
      ? { categoryKey: 'Pick both an activity and a category' }
      : { targetBudgetLineId: 'Pick a working line' },
  };
}

/** Change: assign one transaction to a target the user picked. */
export async function changeAssignmentAction(formData: FormData): Promise<void> {
  const grantId = str(formData, 'grantId');
  const path = back(formData, grantId);
  const orgId = await getOrgId();
  const target = await resolveTarget(orgId, grantId, formData);
  if ('error' in target) redirectWithErrors(path, target.error, formData);
  try {
    await recordDecision(orgId, grantId, {
      kind: 'assign',
      lineIds: [str(formData, 'lineId')],
      targetBudgetLineId: target.id,
      reason: null,
      note: str(formData, 'note') || `Changed to ${target.label}`,
    });
  } catch (e) {
    if (e instanceof ValidationError) redirectWithErrors(path, e.fieldErrors, formData);
    throw e;
  }
  await recalculateAfter(orgId, 'assignment changed');
  done(path);
}

function excludeReason(formData: FormData): string | null {
  const reason = str(formData, 'reason');
  return (EXCLUDE_REASONS as readonly string[]).includes(reason) ? reason : null;
}

/** Not grant-funded: exclude one transaction, optionally drafting the correcting entry. */
export async function notGrantFundedAction(formData: FormData): Promise<void> {
  const grantId = str(formData, 'grantId');
  const path = back(formData, grantId);
  const reason = excludeReason(formData);
  if (!reason) redirectWithErrors(path, { reason: 'Pick a reason' }, formData);
  const orgId = await getOrgId();
  let groupId: string;
  try {
    ({ groupId } = await recordDecision(orgId, grantId, {
      kind: 'exclude',
      lineIds: [str(formData, 'lineId')],
      targetBudgetLineId: null,
      reason,
      note: str(formData, 'note') || `Not grant-funded: ${reason}`,
    }));
  } catch (e) {
    if (e instanceof ValidationError) redirectWithErrors(path, e.fieldErrors, formData);
    throw e;
  }
  await recalculateAfter(orgId, 'transaction marked not grant-funded');
  if (bool(formData, 'draftEntry')) await draftAfterExclude(orgId, grantId, groupId, path);
  done(path);
}

/** Flag at-risk: keeps the transaction in the queue with a note. */
export async function flagAtRiskAction(formData: FormData): Promise<void> {
  const grantId = str(formData, 'grantId');
  const path = back(formData, grantId);
  const note = str(formData, 'note');
  if (!note) redirectWithErrors(path, { note: 'Say why this is at risk' }, formData);
  const orgId = await getOrgId();
  try {
    await recordDecision(orgId, grantId, {
      kind: 'at_risk',
      lineIds: [str(formData, 'lineId')],
      targetBudgetLineId: null,
      reason: null,
      note,
    });
  } catch (e) {
    if (e instanceof ValidationError) redirectWithErrors(path, e.fieldErrors, formData);
    throw e;
  }
  await recalculateAfter(orgId, 'transaction flagged at risk');
  done(path);
}

/** Confirm pair: two `reversal_pair` decisions that exclude both lines. */
export async function confirmPairAction(formData: FormData): Promise<void> {
  const grantId = str(formData, 'grantId');
  const path = back(formData, grantId);
  const orgId = await getOrgId();
  try {
    await recordDecision(orgId, grantId, {
      kind: 'reversal_pair',
      lineIds: [str(formData, 'positiveId'), str(formData, 'negativeId')],
      targetBudgetLineId: null,
      reason: REVERSAL_PAIR_REASON,
      note: str(formData, 'note') || 'Confirmed reversal pair from the review queue',
    });
  } catch (e) {
    if (e instanceof ValidationError) redirectWithErrors(path, e.fieldErrors, formData);
    throw e;
  }
  await recalculateAfter(orgId, 'reversal pair confirmed');
  done(path);
}

/**
 * Bulk: "Accept N" assigns every selected transaction to its own suggested target (recomputed
 * here, so the note is always the reason shown), one decision group per grant and target;
 * "Not grant-funded N" excludes them with one reason, one group per grant, drafting one
 * correcting entry per group when asked.
 */
export async function bulkReviewAction(formData: FormData): Promise<void> {
  const intent = str(formData, 'intent');
  const path = safeReturnPath(str(formData, 'returnTo'), '/review');
  const orgId = await getOrgId();
  const byGrant = selectedByGrant(formData);
  const groups = selectedGroups(formData);
  const grantIds = new Set([...byGrant.keys(), ...groups.keys()]);
  if (grantIds.size === 0)
    redirectWithErrors(path, { rows: 'Select at least one transaction' }, formData);

  const reason = intent === 'exclude' ? excludeReason(formData) : null;
  if (intent === 'exclude' && !reason) redirectWithErrors(path, { reason: 'Pick a reason' }, formData);
  if (intent !== 'accept' && intent !== 'exclude')
    redirectWithErrors(path, { intent: 'Choose Accept or Not grant-funded' }, formData);

  let accepted = 0;
  let excluded = 0;
  const excludeGroups: Array<{ grantId: string; groupId: string }> = [];
  for (const grantId of grantIds) {
    // The same rows the page shows (unfiltered): lines sitting in a proposed reversal pair are a
    // pair row with their own Confirm action, never part of a bulk accept or exclusion.
    const grantQueue = await grantReviewQueue(orgId, grantId);
    if (!grantQueue) continue;
    const suggestions = new Map<string, Suggestion>();
    for (const row of grantQueue.rows) if (row.kind === 'line') suggestions.set(row.line.id, row.suggestion);
    const picked = new Set((byGrant.get(grantId) ?? []).filter((id) => suggestions.has(id)));
    // A ticked group header stands for the rows it listed when rendered — only those still
    // waiting and still suggested to that target.
    for (const { targetId, lineIds } of groups.get(grantId) ?? [])
      for (const lineId of lineIds)
        if (suggestions.get(lineId)?.targetBudgetLineId === targetId) picked.add(lineId);
    if (picked.size === 0) continue;
    try {
      if (intent === 'accept') {
        const byTarget = new Map<string, { lineIds: string[]; reason: string }>();
        for (const lineId of picked) {
          const s = suggestions.get(lineId);
          if (!s?.targetBudgetLineId) continue;
          const entry = byTarget.get(s.targetBudgetLineId) ?? { lineIds: [], reason: s.reason };
          entry.lineIds.push(lineId);
          byTarget.set(s.targetBudgetLineId, entry);
        }
        for (const [targetBudgetLineId, { lineIds, reason: note }] of byTarget) {
          await recordDecision(orgId, grantId, {
            kind: 'assign',
            lineIds,
            targetBudgetLineId,
            reason: null,
            note,
          });
          accepted += lineIds.length;
        }
      } else {
        const { groupId } = await recordDecision(orgId, grantId, {
          kind: 'exclude',
          lineIds: [...picked],
          targetBudgetLineId: null,
          reason,
          note: str(formData, 'note') || `Not grant-funded: ${reason}`,
        });
        excluded += picked.size;
        excludeGroups.push({ grantId, groupId });
      }
    } catch (e) {
      if (e instanceof ValidationError) redirectWithErrors(path, e.fieldErrors, formData);
      throw e;
    }
  }
  if (intent === 'accept') {
    if (accepted === 0)
      redirectWithErrors(path, { rows: 'None of the selected transactions has a suggestion' }, formData);
    await recalculateAfter(orgId, `${accepted} suggestions accepted`);
    done(path, { accepted: String(accepted) });
  }
  if (excluded === 0) redirectWithErrors(path, { rows: 'Select at least one transaction' }, formData);
  await recalculateAfter(orgId, `${excluded} transactions marked not grant-funded`);
  const report = { excluded: String(excluded) };
  if (bool(formData, 'draftEntry') && excludeGroups.length === 1) {
    const g = excludeGroups[0]!;
    await draftAfterExclude(orgId, g.grantId, g.groupId, path, report);
  }
  if (bool(formData, 'draftEntry')) {
    // Several grants: draft each; report the codes together.
    const codes: string[] = [];
    for (const g of excludeGroups) {
      try {
        codes.push((await draftReclassForDecisionGroup(orgId, g.grantId, g.groupId)).code);
      } catch (e) {
        if (e instanceof DestinationUnsetError) done(path, { ...report, blocked: '1' });
        if (e instanceof GrantCodingUnsetError) done(path, { ...report, blocked: 'grant' });
        if (e instanceof ValidationError)
          done(path, { ...report, draftError: Object.values(e.fieldErrors).join('; ') });
        throw e;
      }
    }
    done(path, { ...report, drafted: codes.join(', ') });
  }
  done(path, report);
}
