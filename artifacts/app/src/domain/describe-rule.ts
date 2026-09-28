/**
 * One sentence for a rule (JPH-26 B1): "<scope> transactions where <cond> AND <cond> → <target>".
 * Pure: callers pass the id → label maps. Used by the crosswalk and grant rules list pages, the
 * rule builder (server-rendered and live) and, later, the review queue.
 *
 * Two wordings share one grammar:
 * - `sentence` (default) — the builder's grammar from the ticket: "name is …", two items joined
 *   with "or", three or more written "is any of A, B, C".
 * - `list` — the exact wording the list pages rendered before this phase ("party is …", every
 *   item joined with " or ", first letter capitalised, empty → "every line (no conditions)").
 *   AC1 pins those strings byte-for-byte, so the list pages ask for this wording explicitly.
 */
import { formatDate } from '@/domain/format';
import type { Matchers } from '@/domain/matchers';

export interface RuleLabels {
  programs: ReadonlyMap<string, string>;
  accounts: ReadonlyMap<string, string>;
  classes: ReadonlyMap<string, string>;
  locations: ReadonlyMap<string, string>;
  parties: ReadonlyMap<string, string>;
}

export type RuleTarget =
  /** Crosswalk rule: grant › budget line. */
  | { kind: 'crosswalk'; grant: string; budgetLine: string }
  /** Grant rule deciding the working line (or activity × category) directly. */
  | { kind: 'line'; name: string }
  | { kind: 'activity'; name: string }
  | { kind: 'category'; name: string }
  | null;

export interface DescribeRuleInput {
  /** `'all'` for crosswalk rules; the grant name for grant rules. */
  scope: 'all' | { grant: string };
  matchers: Matchers;
  target: RuleTarget;
  labels: RuleLabels;
}

export type RuleWording = 'sentence' | 'list';

export interface RuleDescription {
  /** "All" or the grant name. */
  scope: string;
  /** One entry per matcher group, e.g. "account is Service Providers". */
  conditions: string[];
  /** The conditions joined with " AND " (list wording: capitalised, or the empty-rule text). */
  conditionsText: string;
  /** "Salah › Dana Fairley", "activity Conference" … or "(choose a target)". */
  target: string;
  /** The whole sentence. */
  sentence: string;
}

export const EMPTY_TARGET = '(choose a target)';
const EMPTY_LIST_CONDITIONS = 'every line (no conditions)';

const label = (map: ReadonlyMap<string, string>, id: string) => map.get(id) ?? '(deleted)';

function isList(items: string[], wording: RuleWording): string {
  if (wording === 'list' || items.length <= 2) return `is ${items.join(' or ')}`;
  return `is any of ${items.join(', ')}`;
}

function containsList(items: string[], wording: RuleWording): string {
  const quoted = items.map((n) => `"${n}"`);
  if (wording === 'list' || quoted.length <= 2) return `contains ${quoted.join(' or ')}`;
  return `contains any of ${quoted.join(', ')}`;
}

const day = (iso: string) => formatDate(new Date(`${iso}T00:00:00Z`));

/** Condition phrases in matcher-group order; the grammar is shared by both wordings. */
export function describeConditions(
  m: Matchers,
  labels: RuleLabels,
  wording: RuleWording = 'sentence',
): string[] {
  const parts: string[] = [];
  const names = (ids: string[], map: ReadonlyMap<string, string>) =>
    ids.map((id) => label(map, id));
  if (m.programIds?.length)
    parts.push(`program ${isList(names(m.programIds, labels.programs), wording)}`);
  if (m.accountIds?.length)
    parts.push(`account ${isList(names(m.accountIds, labels.accounts), wording)}`);
  if (m.accountRange)
    parts.push(`account number is between ${m.accountRange.from} and ${m.accountRange.to}`);
  if (m.classIds?.length) parts.push(`class ${isList(names(m.classIds, labels.classes), wording)}`);
  if (m.locationIds?.length)
    parts.push(`location ${isList(names(m.locationIds, labels.locations), wording)}`);
  if (m.partyIds?.length)
    parts.push(
      `${wording === 'list' ? 'party' : 'name'} ${isList(names(m.partyIds, labels.parties), wording)}`,
    );
  if (m.descriptionContains) parts.push(`description contains "${m.descriptionContains}"`);
  if (m.descriptionContainsAny?.length)
    parts.push(`description ${containsList(m.descriptionContainsAny, wording)}`);
  if (m.txnTypes?.length) parts.push(`transaction type ${isList(m.txnTypes, wording)}`);
  if (m.amountSign) parts.push(`amount is ${m.amountSign}`);
  if (m.dateFrom && m.dateTo) parts.push(`date is ${day(m.dateFrom)} to ${day(m.dateTo)}`);
  else if (m.dateFrom) parts.push(`date is on or after ${day(m.dateFrom)}`);
  else if (m.dateTo) parts.push(`date is on or before ${day(m.dateTo)}`);
  return parts;
}

export function describeTarget(target: RuleTarget): string {
  if (!target) return EMPTY_TARGET;
  switch (target.kind) {
    case 'crosswalk':
      return `${target.grant} › ${target.budgetLine}`;
    case 'line':
      return target.name;
    case 'activity':
      return `activity ${target.name}`;
    case 'category':
      return `category ${target.name}`;
  }
}

export function describeRule(
  input: DescribeRuleInput,
  { wording = 'sentence' }: { wording?: RuleWording } = {},
): RuleDescription {
  const scope = input.scope === 'all' ? 'All' : input.scope.grant;
  const conditions = describeConditions(input.matchers, input.labels, wording);
  const joined = conditions.join(' AND ');
  const conditionsText =
    wording === 'list'
      ? conditions.length === 0
        ? EMPTY_LIST_CONDITIONS
        : joined.charAt(0).toUpperCase() + joined.slice(1)
      : joined;
  const target = describeTarget(input.target);
  const sentence =
    conditions.length === 0
      ? `${scope} transactions → ${target}`
      : `${scope} transactions where ${joined} → ${target}`;
  return { scope, conditions, conditionsText, target, sentence };
}

/** Name suggested for a rule the user has not named: the sentence, cut to 80 characters. */
export function suggestRuleName(sentence: string, max = 80): string {
  if (sentence.length <= max) return sentence;
  return `${sentence.slice(0, max - 1).trimEnd()}…`;
}
