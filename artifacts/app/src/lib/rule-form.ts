/**
 * The one reading of the rule builder's form (JPH-26 B2). The server actions, the `?preview=1`
 * bounce and `POST /api/rules/preview` all go through `readRuleValues`, so the matchers JSON a
 * rule is saved with is, by construction, the JSON the preview ran on — with or without JS.
 * Client-safe: no Prisma or schema imports here; validation lives in rule-form-parse.ts.
 */
import type { FormState } from '@/lib/forms';

export type RuleKind = 'crosswalk' | 'grant';
export type RuleDimension = 'line' | 'activity' | 'category';

/** Priority a rule gets when the user leaves the Advanced section alone (ticket B4). */
export const DEFAULT_NEW_PRIORITY = 50;

/** Matcher groups the builder offers as condition rows, in AND order. */
export const CONDITION_GROUPS = [
  'programIds',
  'accountIds',
  'partyIds',
  'classIds',
  'locationIds',
  'descriptionContains',
  'descriptionContainsAny',
  'txnTypes',
  'dateRange',
  'amountSign',
  'accountRange',
] as const;
export type ConditionGroup = (typeof CONDITION_GROUPS)[number];

/** Everything the form carries, as strings — what the builder renders and the reader consumes. */
export interface RuleFormValues {
  name: string;
  dimension: RuleDimension;
  grantBudgetLineId: string;
  targetActivityId: string;
  targetCategoryKey: string;
  priority: string;
  active: boolean;
  programIds: string[];
  accountIds: string[];
  classIds: string[];
  locationIds: string[];
  partyIds: string[];
  txnTypes: string[];
  accountFrom: string;
  accountTo: string;
  descriptionContains: string;
  descriptionContainsAny: string;
  amountSign: string;
  dateFrom: string;
  dateTo: string;
}

export const LIST_FIELDS = [
  'programIds',
  'accountIds',
  'classIds',
  'locationIds',
  'partyIds',
  'txnTypes',
] as const;

export function emptyRuleValues(kind: RuleKind, priority = DEFAULT_NEW_PRIORITY): RuleFormValues {
  return {
    name: '',
    dimension: 'line',
    grantBudgetLineId: '',
    targetActivityId: '',
    targetCategoryKey: '',
    priority: String(priority),
    active: true,
    programIds: [],
    accountIds: [],
    classIds: [],
    locationIds: [],
    partyIds: [],
    txnTypes: [],
    accountFrom: '',
    accountTo: '',
    descriptionContains: '',
    descriptionContainsAny: '',
    amountSign: '',
    dateFrom: '',
    dateTo: '',
  };
}

/** Reads one source of form values: a FormData, a bounced FormState or in-memory values. */
export interface FormReader {
  get(name: string): string;
  getAll(name: string): string[];
  has(name: string): boolean;
}

export function formDataReader(fd: FormData): FormReader {
  return {
    get: (n) => {
      const v = fd.get(n);
      return typeof v === 'string' ? v.trim() : '';
    },
    getAll: (n) => fd.getAll(n).filter((v): v is string => typeof v === 'string' && v !== ''),
    has: (n) => fd.has(n),
  };
}

export function formStateReader(state: FormState): FormReader {
  return {
    get: (n) => {
      const v = state.values[n];
      return (typeof v === 'string' ? v : Array.isArray(v) ? (v[0] ?? '') : '').trim();
    },
    getAll: (n) => {
      const v = state.values[n];
      return (typeof v === 'string' ? [v] : Array.isArray(v) ? v : []).filter((x) => x !== '');
    },
    has: (n) => n in state.values,
  };
}

export function valuesReader(v: RuleFormValues): FormReader {
  const rec = v as unknown as Record<string, string | string[] | boolean>;
  return {
    get: (n) => {
      const x = rec[n];
      return typeof x === 'string' ? x.trim() : x === true ? 'on' : '';
    },
    getAll: (n) => {
      const x = rec[n];
      return Array.isArray(x) ? x : typeof x === 'string' && x ? [x] : [];
    },
    has: (n) => n in rec,
  };
}

const DIMENSIONS: RuleDimension[] = ['line', 'activity', 'category'];

/** Form values as submitted; unknown dimensions fall back to the working line. */
export function readRuleValues(r: FormReader, kind: RuleKind): RuleFormValues {
  const dim = r.get('dimension');
  return {
    name: r.get('name'),
    dimension: DIMENSIONS.includes(dim as RuleDimension) ? (dim as RuleDimension) : 'line',
    grantBudgetLineId: r.get('grantBudgetLineId'),
    targetActivityId: r.get('targetActivityId'),
    targetCategoryKey: r.get('targetCategoryKey'),
    priority: r.get('priority'),
    active: ['on', 'true', '1'].includes(r.get('active')),
    programIds: kind === 'crosswalk' ? r.getAll('programIds') : [],
    accountIds: r.getAll('accountIds'),
    classIds: r.getAll('classIds'),
    locationIds: r.getAll('locationIds'),
    partyIds: r.getAll('partyIds'),
    txnTypes: r.getAll('txnTypes'),
    accountFrom: r.get('accountFrom'),
    accountTo: r.get('accountTo'),
    descriptionContains: r.get('descriptionContains'),
    descriptionContainsAny: r.get('descriptionContainsAny'),
    amountSign: r.get('amountSign'),
    dateFrom: r.get('dateFrom'),
    dateTo: r.get('dateTo'),
  };
}

export const splitAny = (raw: string): string[] =>
  raw
    .split(/[,;\n]/)
    .map((a) => a.trim())
    .filter((a) => a !== '');

/**
 * Raw matchers object (pre-schema) in a fixed key order, identical for every entry path.
 * Groups the user left empty are omitted (the schema treats absent and empty alike), so a
 * stored rule re-saved untouched keeps the same set of keys it was seeded with.
 */
export function matchersFromValues(v: RuleFormValues, kind: RuleKind) {
  const list = <K extends string>(key: K, xs: string[]) =>
    xs.length > 0 ? ({ [key]: xs } as Record<K, string[]>) : {};
  return {
    ...(kind === 'crosswalk' ? list('programIds', v.programIds) : {}),
    ...list('accountIds', v.accountIds),
    ...(v.accountFrom || v.accountTo
      ? { accountRange: { from: v.accountFrom, to: v.accountTo } }
      : {}),
    ...list('classIds', v.classIds),
    ...list('locationIds', v.locationIds),
    ...list('partyIds', v.partyIds),
    ...(v.descriptionContains ? { descriptionContains: v.descriptionContains } : {}),
    ...list('descriptionContainsAny', splitAny(v.descriptionContainsAny)),
    ...list('txnTypes', v.txnTypes),
    ...(v.amountSign ? { amountSign: v.amountSign } : {}),
    ...(v.dateFrom ? { dateFrom: v.dateFrom } : {}),
    ...(v.dateTo ? { dateTo: v.dateTo } : {}),
  };
}
