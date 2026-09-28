/**
 * The "For Review" queue (JPH-27 C2): one row per waiting transaction with a deterministic
 * suggested target and its reason, grouped by suggested target, then the transactions without a
 * suggestion, then proposed reversal pairs (one two-line row each). Built on `reviewQueue` and
 * the pure `suggestFor`; decisions go through ./line-decisions.
 */
import { categoryLabel } from '@/domain/categories';
import { parseMatchers } from '@/domain/matchers';
import {
  suggestAll,
  type AssignedLine,
  type Suggestion,
  type SuggestBudgetLine,
  type SuggestContext,
  type SuggestLine,
  type SuggestRule,
} from '@/domain/suggest';
import { reviewReasonLabel } from '@/copy/terms';
import { prisma } from '@/lib/db';
import { budgetTree, type BudgetTree } from './grant-budget';
import { grantTracking, type GrantTracking } from './grant-figures';
import { reviewQueue, type ReviewLine, type ReviewQueue } from './review';

export interface QueueFilters {
  reason?: string;
  account?: string;
  name?: string;
  from?: string;
  to?: string;
  /** "1" = only rows with an acceptable suggestion, "0" = only rows without one. */
  suggested?: string;
}

export const EXCLUDE_REASONS = ['not allowable', 'posted in error', 'duplicate', 'other'] as const;

export interface QueueLineRow {
  kind: 'line';
  grantId: string;
  grantName: string;
  line: ReviewLine;
  suggestion: Suggestion;
  /** Name of the suggested budget line, when the suggestion can be accepted as is. */
  targetLabel: string | null;
  /** The engine reason in UI vocabulary (shown when there is no suggestion). */
  reasonLabel: string;
  /**
   * Description term of the near-miss rule, so "Always do this" proposes that rule without the
   * missed condition rather than a rule on the name alone (Leah is a description, not a name).
   */
  ruleDescription: string | null;
}

export interface QueuePairRow {
  kind: 'pair';
  grantId: string;
  grantName: string;
  positive: ReviewLine;
  negative: ReviewLine;
  amountCents: number;
}

export type QueueRow = QueueLineRow | QueuePairRow;

export interface QueueGroup {
  key: string;
  kind: 'suggested' | 'unsuggested' | 'pairs';
  /** Suggested budget line id for `suggested` groups. */
  targetId: string | null;
  label: string;
  rows: QueueRow[];
  totalCents: number;
}

export interface TargetOption {
  id: string;
  label: string;
  kind: 'working_line' | 'cell';
  activityId: string | null;
  categoryKey: string | null;
}

export interface GrantQueue {
  grantId: string;
  grantName: string;
  tracking: GrantTracking | null;
  queue: ReviewQueue;
  tree: BudgetTree;
  /** Every row before filters: the header count and total (pairs count once and net to zero). */
  count: number;
  pairCount: number;
  totalCents: number;
  /** Rows after filters, in queue order. */
  rows: QueueRow[];
  groups: QueueGroup[];
  /** Equal-and-opposite proposals whose lines are already settled (kept out of the count). */
  settledPairs: QueuePairRow[];
  targets: TargetOption[];
  activities: Array<{ id: string; name: string }>;
  categories: Array<{ key: string; label: string }>;
  options: { reasons: string[]; accounts: string[]; names: string[] };
  filters: QueueFilters;
}

const NO_SUGGESTION_LABEL = 'No suggestion';
const PAIRS_LABEL = 'Proposed reversal pairs';

function targetOptions(tree: BudgetTree): TargetOption[] {
  const activityName = new Map(tree.activities.map((a) => [a.id, a.name]));
  return tree.all
    .filter((l): l is typeof l & { kind: 'working_line' | 'cell' } => l.kind !== 'funder_category')
    .map((l) => ({
      id: l.id,
      kind: l.kind,
      activityId: l.activityId,
      categoryKey: l.categoryKey,
      label:
        l.kind === 'cell'
          ? `${activityName.get(l.activityId ?? '') ?? '?'} / ${categoryLabel(l.categoryKey)}`
          : l.name,
    }));
}

function toSuggestLine(l: ReviewLine): SuggestLine {
  return {
    id: l.id,
    accountId: l.accountId,
    accountNumber: l.accountNumber,
    classId: l.classId,
    locationId: l.locationId,
    partyId: l.partyId,
    txnPartyId: l.txnPartyId,
    description: l.description,
    memo: l.memo,
    txnDate: l.txnDate,
    programId: null,
    txnType: l.txnType,
    amountCents: l.amountCents,
    reason: l.reason,
    activityId: l.activityId,
    categoryRuleId: l.categoryRuleId,
  };
}

/** Suggestions for the waiting lines of one grant, keyed by line id. */
export async function suggestionsFor(
  orgId: string,
  grantId: string,
  queue: ReviewQueue,
  tree: BudgetTree,
): Promise<Map<string, Suggestion>> {
  const rules = await prisma.crosswalkRule.findMany({
    where: { orgId, grantId },
    orderBy: [{ priority: 'asc' }, { id: 'asc' }],
  });
  const suggestRules: SuggestRule[] = rules.map((r) => ({
    id: r.id,
    name: r.name ?? r.id,
    dimension: r.dimension,
    matchers: parseMatchers(r.matchers),
    priority: r.priority,
    active: r.active,
    targetBudgetLineId: r.grantBudgetLineId,
    targetActivityId: r.targetActivityId,
    targetCategoryKey: r.targetCategoryKey,
  }));
  const budgetLines: SuggestBudgetLine[] = tree.all.map((l) => ({
    id: l.id,
    kind: l.kind,
    activityId: l.activityId,
    categoryKey: l.categoryKey,
  }));
  const assigned: AssignedLine[] = queue.assigned.flatMap((l) =>
    l.budgetLineId
      ? [{ partyId: l.partyId, txnPartyId: l.txnPartyId, budgetLineId: l.budgetLineId }]
      : [],
  );
  const all = [...queue.assigned, ...queue.excluded, ...queue.groups.flatMap((g) => g.lines)];
  const accountNames = new Map(all.map((l) => [l.accountId, l.accountName]));
  const partyNames = new Map<string, string>();
  for (const l of all) {
    if (l.partyId && l.partyName) partyNames.set(l.partyId, l.partyName);
    if (l.txnPartyId && l.txnPartyName) partyNames.set(l.txnPartyId, l.txnPartyName);
  }
  const targets = new Map(targetOptions(tree).map((t) => [t.id, t.label]));
  const activityName = new Map(tree.activities.map((a) => [a.id, a.name]));
  const ctx: SuggestContext = {
    rules: suggestRules,
    budgetLines,
    assigned,
    labels: {
      budgetLine: (id) => targets.get(id) ?? id,
      activity: (id) => activityName.get(id) ?? id,
      category: (key) => categoryLabel(key),
      account: (id) => accountNames.get(id) ?? id,
      party: (id) => partyNames.get(id) ?? id,
    },
  };
  const waiting = queue.groups.flatMap((g) => g.lines).map(toSuggestLine);
  return suggestAll(waiting, ctx);
}

const iso = (d: Date) => d.toISOString().slice(0, 10);

function keep(row: QueueRow, f: QueueFilters): boolean {
  const lines = row.kind === 'line' ? [row.line] : [row.positive, row.negative];
  if (f.reason && !lines.some((l) => (l.reason ?? '') === f.reason)) return false;
  if (f.account && !lines.some((l) => l.accountId === f.account)) return false;
  if (f.name && !lines.some((l) => (l.party ?? '').toLowerCase().includes(f.name!.toLowerCase())))
    return false;
  if (f.from && !lines.some((l) => iso(l.txnDate) >= f.from!)) return false;
  if (f.to && !lines.some((l) => iso(l.txnDate) <= f.to!)) return false;
  if (f.suggested === '1' && !(row.kind === 'line' && row.suggestion.targetBudgetLineId))
    return false;
  if (f.suggested === '0' && row.kind === 'line' && row.suggestion.targetBudgetLineId) return false;
  return true;
}

const byDate = (a: ReviewLine, b: ReviewLine) =>
  a.txnDate.getTime() - b.txnDate.getTime() ||
  (a.docNumber ?? '').localeCompare(b.docNumber ?? '') ||
  a.id.localeCompare(b.id);

/** Rows in queue order: suggested (grouped by target, in budget order), unsuggested, pairs. */
export function groupRows(rows: QueueRow[], targets: TargetOption[]): QueueGroup[] {
  const order = new Map(targets.map((t, i) => [t.id, i]));
  const label = new Map(targets.map((t) => [t.id, t.label]));
  const suggested = new Map<string, QueueLineRow[]>();
  const unsuggested: QueueLineRow[] = [];
  const pairs: QueuePairRow[] = [];
  for (const r of rows) {
    if (r.kind === 'pair') pairs.push(r);
    else if (r.suggestion.targetBudgetLineId) {
      const id = r.suggestion.targetBudgetLineId;
      suggested.set(id, [...(suggested.get(id) ?? []), r]);
    } else unsuggested.push(r);
  }
  const sum = (rs: QueueRow[]) =>
    rs.reduce((n, r) => n + (r.kind === 'line' ? r.line.amountCents : 0), 0);
  const groups: QueueGroup[] = [...suggested.entries()]
    .sort(
      ([a], [b]) =>
        (order.get(a) ?? Number.MAX_SAFE_INTEGER) - (order.get(b) ?? Number.MAX_SAFE_INTEGER) ||
        a.localeCompare(b),
    )
    .map(([targetId, rs]) => ({
      key: `target:${targetId}`,
      kind: 'suggested' as const,
      targetId,
      label: label.get(targetId) ?? targetId,
      rows: rs.sort((a, b) => byDate(a.line, b.line)),
      totalCents: sum(rs),
    }));
  if (unsuggested.length)
    groups.push({
      key: 'unsuggested',
      kind: 'unsuggested',
      targetId: null,
      label: NO_SUGGESTION_LABEL,
      rows: unsuggested.sort((a, b) => byDate(a.line, b.line)),
      totalCents: sum(unsuggested),
    });
  if (pairs.length)
    groups.push({
      key: 'pairs',
      kind: 'pairs',
      targetId: null,
      label: PAIRS_LABEL,
      rows: pairs.sort((a, b) => byDate(a.positive, b.positive)),
      totalCents: 0,
    });
  return groups;
}

export async function grantReviewQueue(
  orgId: string,
  grantId: string,
  filters: QueueFilters = {},
): Promise<GrantQueue | null> {
  const grant = await prisma.grant.findFirst({
    where: { id: grantId, orgId },
    select: { id: true, name: true },
  });
  if (!grant) return null;
  const [queue, tree, tracking] = await Promise.all([
    reviewQueue(orgId, grantId),
    budgetTree(orgId, grantId),
    grantTracking(orgId, grantId),
  ]);
  return buildGrantQueue(orgId, grant, queue, tree, tracking, filters);
}

/** First description term of each rule (the condition "Always do this" keeps from a near miss). */
async function ruleDescriptionTerms(ruleIds: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  if (ruleIds.length === 0) return out;
  const rules = await prisma.crosswalkRule.findMany({
    where: { id: { in: [...new Set(ruleIds)] } },
    select: { id: true, matchers: true },
  });
  for (const r of rules) {
    const m = parseMatchers(r.matchers);
    const term = m.descriptionContains?.trim() || m.descriptionContainsAny?.[0];
    if (term) out.set(r.id, term);
  }
  return out;
}

async function buildGrantQueue(
  orgId: string,
  grant: { id: string; name: string },
  queue: ReviewQueue,
  tree: BudgetTree,
  tracking: GrantTracking | null,
  filters: QueueFilters,
): Promise<GrantQueue> {
  const suggestions = await suggestionsFor(orgId, grant.id, queue, tree);
  const targets = targetOptions(tree);
  const targetLabel = new Map(targets.map((t) => [t.id, t.label]));
  const waiting = queue.groups.flatMap((g) => g.lines);
  const waitingIds = new Set(waiting.map((l) => l.id));
  // A proposal with a waiting line is a queue row; one between settled lines is not counted.
  const pending = queue.proposals.filter(
    (p) => waitingIds.has(p.positive.id) || waitingIds.has(p.negative.id),
  );
  const paired = new Set(pending.flatMap((p) => [p.positive.id, p.negative.id]));
  const ruleDescriptions = await ruleDescriptionTerms(
    [...suggestions.values()].flatMap((s) => (s.ruleId ? [s.ruleId] : [])),
  );
  const lineRows: QueueLineRow[] = waiting
    .filter((l) => !paired.has(l.id))
    .map((l) => {
      const suggestion = suggestions.get(l.id) ?? { confidence: null, reason: l.reason ?? '' };
      return {
        kind: 'line',
        ruleDescription: suggestion.ruleId ? (ruleDescriptions.get(suggestion.ruleId) ?? null) : null,
        grantId: grant.id,
        grantName: grant.name,
        line: l,
        suggestion,
        targetLabel: suggestion.targetBudgetLineId
          ? (targetLabel.get(suggestion.targetBudgetLineId) ?? null)
          : null,
        reasonLabel: reviewReasonLabel(l.reason),
      };
    });
  const pairRow = (p: ReviewQueue['proposals'][number]): QueuePairRow => ({
    kind: 'pair',
    grantId: grant.id,
    grantName: grant.name,
    positive: p.positive,
    negative: p.negative,
    amountCents: p.amountCents,
  });
  const allRows: QueueRow[] = [...lineRows, ...pending.map(pairRow)];
  const rows = allRows.filter((r) => keep(r, filters));
  const uniq = (xs: string[]) => [...new Set(xs)].sort((a, b) => a.localeCompare(b));
  return {
    grantId: grant.id,
    grantName: grant.name,
    tracking,
    queue,
    tree,
    count: allRows.length,
    pairCount: pending.length,
    totalCents: lineRows.reduce((n, r) => n + r.line.amountCents, 0),
    rows,
    groups: groupRows(rows, targets),
    settledPairs: queue.proposals.filter((p) => !pending.includes(p)).map(pairRow),
    targets,
    activities: tree.activities.map((a) => ({ id: a.id, name: a.name })),
    categories: tree.categoryKeys.map((key) => ({ key, label: categoryLabel(key) })),
    options: {
      reasons: uniq(waiting.map((l) => l.reason ?? '').filter(Boolean)),
      accounts: uniq(waiting.map((l) => l.accountId)),
      names: uniq(waiting.map((l) => l.party ?? '').filter(Boolean)),
    },
    filters,
  };
}

export interface OrgQueue {
  grants: GrantQueue[];
  count: number;
  totalCents: number;
}

/** Every membership-tracked, non-archived grant's queue, name order (the `/review` page). */
export async function orgReviewQueue(orgId: string, filters: QueueFilters = {}): Promise<OrgQueue> {
  const grants = await prisma.grant.findMany({
    where: { orgId, status: { not: 'archived' } },
    select: { id: true, name: true },
    orderBy: { name: 'asc' },
  });
  const queues = await Promise.all(
    grants.map(async (g) => {
      const tracking = await grantTracking(orgId, g.id);
      if (tracking?.mode !== 'membership') return null;
      const [queue, tree] = await Promise.all([reviewQueue(orgId, g.id), budgetTree(orgId, g.id)]);
      return buildGrantQueue(orgId, g, queue, tree, tracking, filters);
    }),
  );
  const present = queues.filter((q): q is GrantQueue => q !== null);
  return {
    grants: present,
    count: present.reduce((n, q) => n + q.count, 0),
    totalCents: present.reduce((n, q) => n + q.totalCents, 0),
  };
}
