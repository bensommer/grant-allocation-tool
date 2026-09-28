/**
 * Suggested targets for the review queue (JPH-27 C1). Pure and deterministic: no model calls,
 * every suggestion carries the one-line reason the queue shows next to it.
 *
 * For each transaction waiting for review the strategies run in order and the first hit wins:
 *
 * 1. Near-miss rule — a grant rule that would match if one of its conditions were dropped.
 * 2. Name history — the same name was assigned to one target at least twice in the current run.
 * 3. Account default — the account appears in this grant's rules with exactly one target.
 * 4. Half-resolved activity × category — one side matched; the other still has to be picked.
 * 5. None — the engine's own reason ("no rule match", …) is all there is to say.
 *
 * A suggestion the user can accept in one click has a `targetBudgetLineId`; a partial one names
 * the side that matched so "Change" starts from there.
 */
import { lineMatches, type MatchableLine, type Matchers } from './matchers';

export type SuggestionConfidence = 'rule' | 'history' | 'account' | 'partial' | null;

export interface Suggestion {
  targetBudgetLineId?: string;
  activityId?: string;
  categoryKey?: string;
  confidence: SuggestionConfidence;
  reason: string;
  /** The near-miss rule behind a `rule` suggestion ("Always do this" starts from its conditions). */
  ruleId?: string;
}

export type SuggestDimension = 'line' | 'activity' | 'category';

export interface SuggestRule {
  id: string;
  name: string;
  dimension: SuggestDimension;
  matchers: Matchers;
  priority: number;
  active: boolean;
  targetBudgetLineId: string | null;
  targetActivityId: string | null;
  targetCategoryKey: string | null;
}

export interface SuggestBudgetLine {
  id: string;
  kind: 'funder_category' | 'working_line' | 'cell';
  activityId: string | null;
  categoryKey: string | null;
}

/** A waiting transaction: what the matchers see plus what the engine already resolved. */
export interface SuggestLine extends MatchableLine {
  id: string;
  /** Engine reason (`REVIEW_REASONS`), shown when no strategy hits. */
  reason: string | null;
  /** Activity the engine matched (activity × category grants). */
  activityId: string | null;
  /** Category rule the engine matched (activity × category grants). */
  categoryRuleId: string | null;
}

/** An assigned transaction of the current run, for name history. */
export interface AssignedLine {
  partyId: string | null;
  txnPartyId: string | null;
  budgetLineId: string;
}

export interface SuggestLabels {
  budgetLine: (id: string) => string;
  activity: (id: string) => string;
  category: (key: string) => string;
  account: (id: string) => string;
  party: (id: string) => string;
}

export interface SuggestContext {
  rules: SuggestRule[];
  /** This grant's budget lines. */
  budgetLines: SuggestBudgetLine[];
  assigned: AssignedLine[];
  labels: SuggestLabels;
}

/** Name history needs at least this many earlier assignments to one target. */
export const HISTORY_MIN = 2;

/** The matcher fields a rule can carry, as the conditions a near miss may drop. */
export const CONDITION_LABELS = {
  programIds: 'program',
  accountIds: 'account',
  accountRange: 'account range',
  classIds: 'class',
  locationIds: 'location',
  partyIds: 'name',
  descriptionContains: 'description',
  descriptionContainsAny: 'description',
  txnTypes: 'transaction type',
  amountSign: 'amount sign',
  date: 'date',
} as const;

export type Condition = keyof typeof CONDITION_LABELS;

function present(v: unknown): boolean {
  return !(
    v === undefined ||
    v === null ||
    v === '' ||
    (Array.isArray(v) && v.length === 0)
  );
}

/** The conditions a matcher actually sets (dateFrom/dateTo count as one "date"). */
export function conditionsOf(m: Matchers): Condition[] {
  const out: Condition[] = [];
  for (const key of Object.keys(CONDITION_LABELS) as Condition[]) {
    if (key === 'date') {
      if (present(m.dateFrom) || present(m.dateTo)) out.push('date');
    } else if (present(m[key])) out.push(key);
  }
  return out;
}

export function withoutCondition(m: Matchers, c: Condition): Matchers {
  const rest: Matchers = { ...m };
  if (c === 'date') {
    delete rest.dateFrom;
    delete rest.dateTo;
  } else {
    delete rest[c];
  }
  return rest;
}

/**
 * The one condition of `rule` that keeps `line` from matching, or null when the rule has fewer
 * than two conditions (dropping the only one would match everything), already matches, or
 * misses on more than one.
 */
export function nearMissCondition(line: MatchableLine, rule: SuggestRule): Condition | null {
  const conditions = conditionsOf(rule.matchers);
  if (conditions.length < 2) return null;
  if (lineMatches(line, rule.matchers)) return null;
  for (const c of conditions) {
    if (lineMatches(line, withoutCondition(rule.matchers, c))) return c;
  }
  return null;
}

const byPriority = (a: SuggestRule, b: SuggestRule) =>
  a.priority - b.priority || a.id.localeCompare(b.id);

function cellOf(ctx: SuggestContext, activityId: string | null, categoryKey: string | null) {
  if (!activityId || !categoryKey) return null;
  return (
    ctx.budgetLines.find(
      (b) => b.kind === 'cell' && b.activityId === activityId && b.categoryKey === categoryKey,
    ) ?? null
  );
}

function lineOf(ctx: SuggestContext, id: string | null) {
  if (!id) return null;
  return ctx.budgetLines.find((b) => b.id === id && b.kind !== 'funder_category') ?? null;
}

/** The category the engine matched for this line, if any. */
function matchedCategory(line: SuggestLine, ctx: SuggestContext): string | null {
  if (!line.categoryRuleId) return null;
  return ctx.rules.find((r) => r.id === line.categoryRuleId)?.targetCategoryKey ?? null;
}

/**
 * Resolves a rule's target for a line to a budget line, using the side the engine already
 * matched to complete an activity × category. Null when no acceptable budget line follows.
 */
function targetOfRule(
  rule: SuggestRule,
  line: SuggestLine,
  ctx: SuggestContext,
): Pick<Suggestion, 'targetBudgetLineId' | 'activityId' | 'categoryKey'> | null {
  if (rule.dimension === 'line') {
    const target = lineOf(ctx, rule.targetBudgetLineId);
    return target ? targetFields(target) : null;
  }
  const activityId = rule.dimension === 'activity' ? rule.targetActivityId : line.activityId;
  const categoryKey =
    rule.dimension === 'category' ? rule.targetCategoryKey : matchedCategory(line, ctx);
  const cell = cellOf(ctx, activityId, categoryKey);
  return cell ? targetFields(cell) : null;
}

function targetFields(b: SuggestBudgetLine) {
  return {
    targetBudgetLineId: b.id,
    ...(b.activityId ? { activityId: b.activityId } : {}),
    ...(b.categoryKey ? { categoryKey: b.categoryKey } : {}),
  };
}

/**
 * The closest rule wins: the one with the most conditions satisfied (a three-condition rule
 * missing only its date beats a two-condition rule missing its description), then priority.
 */
function suggestNearMiss(line: SuggestLine, ctx: SuggestContext): Suggestion | null {
  const rules = ctx.rules.filter((r) => r.active).sort(byPriority);
  let best: { suggestion: Suggestion; matched: number } | null = null;
  for (const rule of rules) {
    const missed = nearMissCondition(line, rule);
    if (!missed) continue;
    const target = targetOfRule(rule, line, ctx);
    if (!target) continue;
    const matched = conditionsOf(rule.matchers).length - 1;
    if (best && matched <= best.matched) continue;
    best = {
      matched,
      suggestion: {
        ...target,
        confidence: 'rule',
        reason: `Matches rule "${rule.name}" except the ${CONDITION_LABELS[missed]}`,
        ruleId: rule.id,
      },
    };
  }
  return best?.suggestion ?? null;
}

function suggestHistory(line: SuggestLine, ctx: SuggestContext): Suggestion | null {
  const party = line.partyId ?? line.txnPartyId;
  if (!party) return null;
  const counts = new Map<string, number>();
  for (const a of ctx.assigned) {
    if ((a.partyId ?? a.txnPartyId) !== party) continue;
    counts.set(a.budgetLineId, (counts.get(a.budgetLineId) ?? 0) + 1);
  }
  // Highest count wins; a tie goes to the earlier budget line, so the answer never flips.
  let best: { id: string; n: number } | null = null;
  for (const b of ctx.budgetLines) {
    const n = counts.get(b.id) ?? 0;
    if (n >= HISTORY_MIN && (!best || n > best.n)) best = { id: b.id, n };
  }
  if (!best) return null;
  const target = lineOf(ctx, best.id);
  if (!target) return null;
  return {
    ...targetFields(target),
    confidence: 'history',
    reason: `${ctx.labels.party(party)} was sent here ${best.n} times before`,
  };
}

function suggestAccountDefault(line: SuggestLine, ctx: SuggestContext): Suggestion | null {
  const rules = ctx.rules
    .filter((r) => r.active && (r.matchers.accountIds ?? []).includes(line.accountId))
    .sort(byPriority);
  if (rules.length === 0) return null;
  const targets = new Set(
    rules.map((r) =>
      r.dimension === 'line'
        ? `line:${r.targetBudgetLineId ?? ''}`
        : r.dimension === 'activity'
          ? `activity:${r.targetActivityId ?? ''}`
          : `category:${r.targetCategoryKey ?? ''}`,
    ),
  );
  if (targets.size !== 1) return null;
  const rule = rules[0]!;
  const target = targetOfRule(rule, line, ctx);
  if (!target?.targetBudgetLineId) return null;
  return {
    ...target,
    confidence: 'account',
    reason: `${ctx.labels.account(line.accountId)} always goes to ${ctx.labels.budgetLine(target.targetBudgetLineId)}`,
  };
}

function suggestPartial(line: SuggestLine, ctx: SuggestContext): Suggestion | null {
  const categoryKey = matchedCategory(line, ctx);
  if (line.activityId && !categoryKey) {
    return {
      activityId: line.activityId,
      confidence: 'partial',
      reason: `Activity matched ${ctx.labels.activity(line.activityId)}; pick a category`,
    };
  }
  if (categoryKey && !line.activityId) {
    return {
      categoryKey,
      confidence: 'partial',
      reason: `Category matched ${ctx.labels.category(categoryKey)}; pick an activity`,
    };
  }
  return null;
}

/** Shown when no strategy hits and the engine left no reason. */
export const NO_REASON = 'needs review';

export function suggestFor(line: SuggestLine, ctx: SuggestContext): Suggestion {
  return (
    suggestNearMiss(line, ctx) ??
    suggestHistory(line, ctx) ??
    suggestAccountDefault(line, ctx) ??
    suggestPartial(line, ctx) ?? { confidence: null, reason: line.reason ?? NO_REASON }
  );
}

export function suggestAll(lines: SuggestLine[], ctx: SuggestContext): Map<string, Suggestion> {
  return new Map(lines.map((l) => [l.id, suggestFor(l, ctx)]));
}
