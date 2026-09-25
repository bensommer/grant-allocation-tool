/**
 * Pure grant stage (JPH-21). No I/O.
 *
 * For every grant, every member line ends in exactly one state:
 *
 *   1. Decisions — the newest active decision for (grant, line) wins:
 *      `exclude` / `reversal_pair` → excluded; `assign` → assigned to its
 *      target line (or cell). `at_risk` only flags the line and never changes
 *      the state.
 *   2. Grant rules — line-dimension rules ordered by priority (lowest first,
 *      then id); the first match assigns the line to the rule's target.
 *   3. Activity × category — when the grant has activity- or category-dimension
 *      rules, resolve each side the same way and look up the cell
 *      (activityId, categoryKey). Missing pieces give a review reason:
 *      "no activity match", "no category match", "no budget cell".
 *   4. Otherwise → needs_review with reason "no rule match".
 *
 * Only expense-account member lines take part; grant income (the award
 * deposits) is a receipt, not spend. Grant rules never look at the grant's
 * date window: membership already scopes the lines.
 */
import { lineMatches, type Matchers } from '@/domain/matchers';
import type { EngineLine } from './core';

export type GrantLineState = 'assigned' | 'excluded' | 'needs_review';
export type RuleDimension = 'line' | 'activity' | 'category';
export type DecisionKind = 'assign' | 'exclude' | 'at_risk' | 'reversal_pair';

export interface GrantStageRule {
  id: string;
  grantId: string;
  dimension: RuleDimension;
  matchers: Matchers;
  priority: number;
  active: boolean;
  targetBudgetLineId: string | null;
  targetActivityId: string | null;
  targetCategoryKey: string | null;
}

export interface GrantStageBudgetLine {
  id: string;
  grantId: string;
  kind: 'funder_category' | 'working_line' | 'cell';
  activityId: string | null;
  categoryKey: string | null;
}

/** A decision already resolved to a loaded line (fingerprint → id happens in the loader). */
export interface GrantStageDecision {
  id: string;
  grantId: string;
  lineId: string;
  kind: DecisionKind;
  targetBudgetLineId: string | null;
  reason: string | null;
  /** Monotonic order; larger = newer. */
  seq: number;
}

export interface GrantStageConfig {
  grantIds: string[];
  /** Active memberships: grantId → member line ids. */
  memberships: Array<{ grantId: string; lineId: string }>;
  rules: GrantStageRule[];
  budgetLines: GrantStageBudgetLine[];
  decisions: GrantStageDecision[];
}

export interface GrantLineDraft {
  grantId: string;
  transactionLineId: string;
  state: GrantLineState;
  budgetLineId: string | null;
  activityId: string | null;
  ruleId: string | null;
  categoryRuleId: string | null;
  decisionId: string | null;
  reason: string | null;
  atRisk: boolean;
  amountCents: number;
}

export const REVIEW_REASONS = {
  noRule: 'no rule match',
  noActivity: 'no activity match',
  noCategory: 'no category match',
  noCell: 'no budget cell',
  badDecisionTarget: 'decision target missing',
} as const;

function byPriority<T extends { priority: number; id: string }>(rules: T[]): T[] {
  return [...rules].sort((a, b) => a.priority - b.priority || a.id.localeCompare(b.id));
}

export function assignGrantLines(lines: EngineLine[], config: GrantStageConfig): GrantLineDraft[] {
  const lineById = new Map(lines.map((l) => [l.id, l]));
  const budgetLineById = new Map(config.budgetLines.map((b) => [b.id, b]));
  const out: GrantLineDraft[] = [];

  for (const grantId of [...config.grantIds].sort()) {
    const memberIds = [
      ...new Set(config.memberships.filter((m) => m.grantId === grantId).map((m) => m.lineId)),
    ].sort();
    const grantRules = config.rules.filter((r) => r.grantId === grantId && r.active);
    const lineRules = byPriority(grantRules.filter((r) => r.dimension === 'line'));
    const activityRules = byPriority(grantRules.filter((r) => r.dimension === 'activity'));
    const categoryRules = byPriority(grantRules.filter((r) => r.dimension === 'category'));
    const usesCells = activityRules.length > 0 || categoryRules.length > 0;
    const cells = new Map<string, GrantStageBudgetLine>();
    for (const b of config.budgetLines) {
      if (b.grantId === grantId && b.kind === 'cell' && b.activityId && b.categoryKey)
        cells.set(`${b.activityId}|${b.categoryKey}`, b);
    }
    const decisionsByLine = new Map<string, GrantStageDecision[]>();
    for (const d of config.decisions) {
      if (d.grantId !== grantId) continue;
      const list = decisionsByLine.get(d.lineId) ?? [];
      list.push(d);
      decisionsByLine.set(d.lineId, list);
    }

    for (const lineId of memberIds) {
      const line = lineById.get(lineId);
      if (!line || line.accountKind !== 'expense') continue;
      const draft: GrantLineDraft = {
        grantId,
        transactionLineId: lineId,
        state: 'needs_review',
        budgetLineId: null,
        activityId: null,
        ruleId: null,
        categoryRuleId: null,
        decisionId: null,
        reason: null,
        atRisk: false,
        amountCents: line.amountCents,
      };
      const decisions = (decisionsByLine.get(lineId) ?? []).sort((a, b) => b.seq - a.seq);
      draft.atRisk = decisions.some((d) => d.kind === 'at_risk');
      const stateDecision = decisions.find((d) => d.kind !== 'at_risk');

      if (stateDecision) {
        draft.decisionId = stateDecision.id;
        if (stateDecision.kind === 'assign') {
          const target = stateDecision.targetBudgetLineId
            ? budgetLineById.get(stateDecision.targetBudgetLineId)
            : undefined;
          if (target && target.grantId === grantId) {
            draft.state = 'assigned';
            draft.budgetLineId = target.id;
            draft.activityId = target.activityId;
            draft.reason = stateDecision.reason;
          } else {
            draft.state = 'needs_review';
            draft.reason = REVIEW_REASONS.badDecisionTarget;
          }
        } else {
          draft.state = 'excluded';
          draft.reason =
            stateDecision.reason ??
            (stateDecision.kind === 'reversal_pair' ? 'reversal pair' : 'excluded');
        }
        out.push(draft);
        continue;
      }

      const matchable = {
        accountId: line.accountId,
        accountNumber: line.accountNumber,
        classId: line.classId,
        locationId: line.locationId,
        partyId: line.partyId,
        txnPartyId: line.txnPartyId,
        description: line.description,
        memo: line.memo,
        txnDate: line.txnDate,
        programId: null,
        txnType: line.txnType ?? null,
        amountCents: line.amountCents,
      };
      const lineRule = lineRules.find(
        (r) => r.targetBudgetLineId !== null && lineMatches(matchable, r.matchers),
      );
      if (lineRule) {
        const target = budgetLineById.get(lineRule.targetBudgetLineId!);
        draft.ruleId = lineRule.id;
        if (target && target.grantId === grantId) {
          draft.state = 'assigned';
          draft.budgetLineId = target.id;
          draft.activityId = target.activityId;
        } else {
          draft.reason = REVIEW_REASONS.noCell;
        }
        out.push(draft);
        continue;
      }

      if (!usesCells) {
        draft.reason = REVIEW_REASONS.noRule;
        out.push(draft);
        continue;
      }
      const activityRule = activityRules.find(
        (r) => r.targetActivityId !== null && lineMatches(matchable, r.matchers),
      );
      const categoryRule = categoryRules.find(
        (r) => r.targetCategoryKey !== null && lineMatches(matchable, r.matchers),
      );
      draft.ruleId = activityRule?.id ?? null;
      draft.categoryRuleId = categoryRule?.id ?? null;
      draft.activityId = activityRule?.targetActivityId ?? null;
      if (!activityRule) {
        draft.reason = REVIEW_REASONS.noActivity;
      } else if (!categoryRule) {
        draft.reason = REVIEW_REASONS.noCategory;
      } else {
        const cell = cells.get(`${activityRule.targetActivityId}|${categoryRule.targetCategoryKey}`);
        if (!cell) {
          draft.reason = REVIEW_REASONS.noCell;
        } else {
          draft.state = 'assigned';
          draft.budgetLineId = cell.id;
        }
      }
      out.push(draft);
    }
  }
  return out;
}

export interface ReversalPairProposal {
  grantId: string;
  positiveLineId: string;
  negativeLineId: string;
  amountCents: number;
}

/** What the pairing heuristics know about a line beyond its draft result. */
export interface ReversalPairLineInfo {
  accountId: string | null;
  docNumber: string | null;
  description: string | null;
  partyId: string | null;
  txnDate: Date | null;
}

/**
 * Ranks a candidate counterpart for `pos`: a description that cites the other
 * line's document number ("re-cut 3330", "Reverse check 3224") beats a shared
 * payee, which beats the nearest date. Lower is better.
 */
function pairScore(pos: ReversalPairLineInfo, neg: ReversalPairLineInfo): number {
  const cites = (a: ReversalPairLineInfo, b: ReversalPairLineInfo) =>
    !!b.docNumber &&
    b.docNumber.trim() !== '' &&
    new RegExp(`(^|[^0-9])${escapeRegExp(b.docNumber.trim())}([^0-9]|$)`).test(a.description ?? '');
  if (cites(neg, pos) || cites(pos, neg)) return 0;
  if (pos.partyId && pos.partyId === neg.partyId) return 1;
  const days =
    pos.txnDate && neg.txnDate
      ? Math.abs(neg.txnDate.getTime() - pos.txnDate.getTime()) / 86_400_000
      : 1e6;
  return 2 + days / 1e7;
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Proposes reversal pairs among a grant's current results: two member lines on
 * the same account with amounts a and −a that are both still needs_review, or
 * both rule-assigned (no decision) to the same budget line. Each line is used
 * at most once. Positives are visited in line-id order; for each, the best
 * counterpart by `pairScore` wins, so a "re-cut" or "reverse check N" line is
 * paired with the check it names rather than the first equal amount.
 */
export function proposeReversalPairs(
  drafts: GrantLineDraft[],
  infoOf: (lineId: string) => ReversalPairLineInfo | null,
): ReversalPairProposal[] {
  const proposals: ReversalPairProposal[] = [];
  const eligible = drafts.filter(
    (d) =>
      d.decisionId === null &&
      d.amountCents !== 0 &&
      (d.state === 'needs_review' || d.state === 'assigned'),
  );
  const none: ReversalPairLineInfo = {
    accountId: null,
    docNumber: null,
    description: null,
    partyId: null,
    txnDate: null,
  };
  const info = (d: GrantLineDraft) => infoOf(d.transactionLineId) ?? none;
  const key = (d: GrantLineDraft) =>
    `${d.grantId}|${info(d).accountId ?? ''}|${d.state}|${d.budgetLineId ?? ''}`;
  const buckets = new Map<string, GrantLineDraft[]>();
  for (const d of eligible) {
    const list = buckets.get(key(d)) ?? [];
    list.push(d);
    buckets.set(key(d), list);
  }
  for (const list of buckets.values()) {
    const sorted = [...list].sort((a, b) => a.transactionLineId.localeCompare(b.transactionLineId));
    const used = new Set<string>();
    // Cited pairs first so a named counterpart is never taken by an earlier positive.
    for (const pass of ['cited', 'any'] as const) {
      for (const pos of sorted) {
        if (pos.amountCents <= 0 || used.has(pos.transactionLineId)) continue;
        let best: GrantLineDraft | null = null;
        let bestScore = Infinity;
        for (const n of sorted) {
          if (used.has(n.transactionLineId) || n.amountCents !== -pos.amountCents) continue;
          const score = pairScore(info(pos), info(n));
          if (score < bestScore) {
            best = n;
            bestScore = score;
          }
        }
        if (!best || (pass === 'cited' && bestScore !== 0)) continue;
        used.add(pos.transactionLineId);
        used.add(best.transactionLineId);
        proposals.push({
          grantId: pos.grantId,
          positiveLineId: pos.transactionLineId,
          negativeLineId: best.transactionLineId,
          amountCents: pos.amountCents,
        });
      }
    }
  }
  return proposals;
}
