/**
 * First-grant setup wizard (JPH-29 E4): the draft's shape and the pure parsers for each step.
 * Each step stores the values it posted (so a refresh or browser Back re-renders exactly what
 * was typed); the typed data is derived from those values here, never stored twice.
 */
import { z } from 'zod';
import { parseDateInput } from './dates';
import { MoneyParseError, parseMoneyToCents } from './money';
import type { TrackingFields } from './tracking-choice';

export const WIZARD_STEPS = [
  { n: 1, title: 'The award' },
  { n: 2, title: 'How QuickBooks tracks it' },
  { n: 3, title: 'Funder budget' },
  { n: 4, title: 'Working lines' },
  { n: 5, title: 'Starting rules' },
] as const;
export type WizardStep = 1 | 2 | 3 | 4 | 5;
export const LAST_STEP = 5;

export function wizardStep(raw: string | undefined): WizardStep | null {
  const n = Number(raw);
  return n >= 1 && n <= LAST_STEP && Number.isInteger(n) ? (n as WizardStep) : null;
}

/** Posted values of one step, as `redirectWithErrors` keeps them. */
export type StepValues = Record<string, string | string[]>;

export const draftDataSchema = z.object({
  /** Posted values per step, keyed "1".."5". */
  values: z.record(z.string(), z.record(z.string(), z.union([z.string(), z.array(z.string())]))),
  /** Step 2's resolved fields (memberClassIds …), written when step 2 is continued. */
  tracking: z
    .object({
      memberClassIds: z.array(z.string()),
      memberPartyIds: z.array(z.string()),
      qboClassName: z.string().nullable(),
      qboProjectName: z.string().nullable(),
    })
    .nullable()
    .default(null),
});
export type DraftData = z.infer<typeof draftDataSchema>;

export const emptyDraft = (): DraftData => ({ values: {}, tracking: null });

export function parseDraftData(raw: unknown): DraftData {
  const r = draftDataSchema.safeParse(raw);
  return r.success ? r.data : emptyDraft();
}

const s = (v: StepValues, k: string) => {
  const x = v[k];
  return (typeof x === 'string' ? x : (x?.[0] ?? '')).trim();
};
const many = (v: StepValues, k: string): string[] => {
  const x = v[k];
  return x === undefined ? [] : Array.isArray(x) ? x : [x];
};

// --- step 1: the award ------------------------------------------------------------------

export const RESTRICTION_TYPES = ['purpose', 'time', 'both', 'unrestricted'] as const;

export interface AwardData {
  name: string;
  funderText: string;
  awardNumber: string | null;
  awardAmountCents: number;
  startDate: Date;
  endDate: Date;
  restrictionType: (typeof RESTRICTION_TYPES)[number];
}

export type Parsed<T> = { ok: true; data: T } | { ok: false; errors: Record<string, string> };

export function parseAward(v: StepValues): Parsed<AwardData> {
  const errors: Record<string, string> = {};
  const name = s(v, 'name');
  if (!name) errors['name'] = 'Enter the grant name';
  const funderText = s(v, 'funderText');
  if (!funderText) errors['funderText'] = 'Enter the funder';
  let awardAmountCents = 0;
  try {
    awardAmountCents = parseMoneyToCents(s(v, 'awardAmount'));
    if (awardAmountCents <= 0) errors['awardAmount'] = 'Enter the award amount';
  } catch (e) {
    errors['awardAmount'] =
      e instanceof MoneyParseError ? 'Enter an amount like 1,234.56' : 'Invalid amount';
  }
  const date = (k: string) => {
    try {
      return parseDateInput(s(v, k));
    } catch {
      errors[k] = 'Enter a date as YYYY-MM-DD';
      return new Date(0);
    }
  };
  const startDate = date('startDate');
  const endDate = date('endDate');
  if (!errors['startDate'] && !errors['endDate'] && endDate < startDate)
    errors['endDate'] = 'End date must be on or after start date';
  const rt = s(v, 'restrictionType') || 'purpose';
  if (!(RESTRICTION_TYPES as readonly string[]).includes(rt))
    errors['restrictionType'] = 'Choose a restriction type';
  if (Object.keys(errors).length) return { ok: false, errors };
  return {
    ok: true,
    data: {
      name,
      funderText,
      awardNumber: s(v, 'awardNumber') || null,
      awardAmountCents,
      startDate,
      endDate,
      restrictionType: rt as AwardData['restrictionType'],
    },
  };
}

// --- step 3: funder budget ---------------------------------------------------------------

export interface DraftCategory {
  code: string;
  name: string;
  budgetCents: number;
}

/** The persisted budget line code shape (services/grants.ts `budgetLineInputSchema`). */
export const BUDGET_CODE_PATTERN = /^[A-Za-z0-9_.-]+$/;
export const BUDGET_CODE_MAX = 30;
export const BUDGET_NAME_MAX = 200;

function codeProblem(code: string): string | null {
  if (code.length > BUDGET_CODE_MAX) return `Codes are at most ${BUDGET_CODE_MAX} characters`;
  if (!BUDGET_CODE_PATTERN.test(code))
    return 'Codes use letters, numbers, dash, dot, underscore only';
  return null;
}

/** Budget line code from a name: letters and digits, upper case, at most 12 characters. */
export function codeFromName(name: string, taken: Set<string>): string {
  const base =
    name
      .normalize('NFKD')
      .replace(/[^A-Za-z0-9 ]/g, '')
      .trim()
      .split(/\s+/)
      .map((w) => w.toUpperCase())
      .join('')
      .slice(0, 12) || 'LINE';
  let code = base;
  for (let i = 2; taken.has(code); i++) code = `${base.slice(0, 12 - String(i).length)}${i}`;
  taken.add(code);
  return code;
}

/**
 * "Paste two columns": one category per line, name then amount separated by a tab, two or more
 * spaces, a comma outside quotes, or " – ". A third leading column is read as the code.
 */
export function parsePastedBudget(
  text: string,
): Array<{ code: string; name: string; amount: string }> {
  const rows: Array<{ code: string; name: string; amount: string }> = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    let parts = line.split(/\t+/).map((p) => p.trim());
    if (parts.length < 2) parts = line.split(/ {2,}/).map((p) => p.trim());
    if (parts.length < 2) {
      // "Name, 1,234.56" — amount is the last comma-separated token that parses as money.
      const m = /^(.*?)[,;]\s*(\$?-?[\d,]+(?:\.\d{1,2})?)$/.exec(line);
      if (m) parts = [m[1]!.trim(), m[2]!];
      else {
        const sp = /^(.*\S)\s+(\$?-?[\d,]+(?:\.\d{1,2})?)$/.exec(line);
        parts = sp ? [sp[1]!.trim(), sp[2]!] : [line];
      }
    }
    if (parts.length >= 3) rows.push({ code: parts[0]!, name: parts[1]!, amount: parts[2]! });
    else if (parts.length === 2) rows.push({ code: '', name: parts[0]!, amount: parts[1]! });
    else rows.push({ code: '', name: parts[0]!, amount: '' });
  }
  return rows;
}

/** Row inputs are posted as parallel lists: catCode[], catName[], catAmount[]. */
export function budgetRows(v: StepValues) {
  const codes = many(v, 'catCode');
  const names = many(v, 'catName');
  const amounts = many(v, 'catAmount');
  const n = Math.max(codes.length, names.length, amounts.length);
  const rows: Array<{ code: string; name: string; amount: string }> = [];
  for (let i = 0; i < n; i++)
    rows.push({
      code: (codes[i] ?? '').trim(),
      name: (names[i] ?? '').trim(),
      amount: (amounts[i] ?? '').trim(),
    });
  return rows;
}

export function parseBudget(v: StepValues): Parsed<DraftCategory[]> {
  const errors: Record<string, string> = {};
  const rows = budgetRows(v).filter((r) => r.code || r.name || r.amount);
  const taken = new Set<string>();
  const out: DraftCategory[] = [];
  rows.forEach((r, i) => {
    if (!r.name) errors[`catName_${i}`] = 'Enter a category name';
    else if (r.name.length > BUDGET_NAME_MAX)
      errors[`catName_${i}`] = `Names are at most ${BUDGET_NAME_MAX} characters`;
    let cents = 0;
    try {
      cents = parseMoneyToCents(r.amount);
      if (cents < 0) errors[`catAmount_${i}`] = 'Amounts cannot be negative';
    } catch {
      errors[`catAmount_${i}`] = 'Enter an amount like 1,234.56';
    }
    const code = r.code ? r.code.toUpperCase() : codeFromName(r.name, taken);
    if (r.code) {
      const problem = codeProblem(code);
      if (problem) errors[`catCode_${i}`] = problem;
      else if (taken.has(code)) errors[`catCode_${i}`] = `Code ${code} is used twice`;
      taken.add(code);
    }
    out.push({ code, name: r.name, budgetCents: cents });
  });
  if (out.length === 0) errors['_'] = 'Add at least one funder category';
  if (Object.keys(errors).length) return { ok: false, errors };
  return { ok: true, data: out };
}

// --- step 4: working lines --------------------------------------------------------------

export interface DraftLine {
  code: string;
  name: string;
  budgetCents: number;
  /** Index into the step 3 categories. */
  category: number;
}

/** "No" — working lines are the categories themselves, one per category. */
export function linesFromCategories(categories: DraftCategory[]): DraftLine[] {
  const taken = new Set(categories.map((c) => c.code));
  return categories.map((c, i) => ({
    code: codeFromName(c.name, taken),
    name: c.name,
    budgetCents: c.budgetCents,
    category: i,
  }));
}

/** Row inputs per category: lineCat[], lineCode[], lineName[], lineAmount[] (parallel). */
export function lineRows(v: StepValues) {
  const cats = many(v, 'lineCat');
  const codes = many(v, 'lineCode');
  const names = many(v, 'lineName');
  const amounts = many(v, 'lineAmount');
  const rows: Array<{ category: number; code: string; name: string; amount: string }> = [];
  for (let i = 0; i < cats.length; i++)
    rows.push({
      category: Number(cats[i]),
      code: (codes[i] ?? '').trim(),
      name: (names[i] ?? '').trim(),
      amount: (amounts[i] ?? '').trim(),
    });
  return rows;
}

export function parseLines(v: StepValues, categories: DraftCategory[]): Parsed<DraftLine[]> {
  const errors: Record<string, string> = {};
  const rows = lineRows(v).filter((r) => r.code || r.name || r.amount);
  const taken = new Set(categories.map((c) => c.code));
  const out: DraftLine[] = [];
  rows.forEach((r, i) => {
    if (!Number.isInteger(r.category) || !categories[r.category]) {
      errors[`lineName_${i}`] = 'Unknown category';
      return;
    }
    if (!r.name) errors[`lineName_${i}`] = 'Enter a line name';
    else if (r.name.length > BUDGET_NAME_MAX)
      errors[`lineName_${i}`] = `Names are at most ${BUDGET_NAME_MAX} characters`;
    let cents = 0;
    try {
      cents = parseMoneyToCents(r.amount);
      if (cents < 0) errors[`lineAmount_${i}`] = 'Amounts cannot be negative';
    } catch {
      errors[`lineAmount_${i}`] = 'Enter an amount like 1,234.56';
    }
    const code = r.code ? r.code.toUpperCase() : codeFromName(r.name, taken);
    if (r.code) {
      const problem = codeProblem(code);
      if (problem) errors[`lineCode_${i}`] = problem;
      else if (taken.has(code)) errors[`lineCode_${i}`] = `Code ${code} is used twice`;
      taken.add(code);
    }
    out.push({ code, name: r.name, budgetCents: cents, category: r.category });
  });
  for (let c = 0; c < categories.length; c++)
    if (!out.some((l) => l.category === c))
      errors['_'] =
        `Every category needs at least one working line (${categories[c]!.name} has none)`;
  if (Object.keys(errors).length) return { ok: false, errors };
  return { ok: true, data: out };
}

/** Total of the working lines under each category versus the category — the step 4 chips. */
export function lineTotals(lines: DraftLine[], categories: DraftCategory[]) {
  return categories.map((c, i) => {
    const total = lines.filter((l) => l.category === i).reduce((a, l) => a + l.budgetCents, 0);
    return { category: c, totalCents: total, differenceCents: total - c.budgetCents };
  });
}

// --- step 5: starting rules -------------------------------------------------------------

/** One proposed row: an account, or a name under an account. */
export interface RuleRowKey {
  accountId: string;
  partyId: string | null;
}

export const ruleRowKey = (k: RuleRowKey) => `${k.accountId}|${k.partyId ?? ''}`;

/** Posted target for each row: `rule_<key>` = line code or 'later'. */
export function ruleChoices(v: StepValues): Map<string, string> {
  const out = new Map<string, string>();
  for (const [k, val] of Object.entries(v))
    if (k.startsWith('rule_') && typeof val === 'string') out.set(k.slice(5), val);
  return out;
}

export type { TrackingFields };

// --- step 2: grant income -----------------------------------------------------------------

/** Field names of the Grant income block; `posted` marks a step-2 post (an empty selection
 * posts no values, so the marker tells "cleared" from "never shown"). */
export const INCOME_FIELDS = {
  parties: 'matchPartyIds',
  classes: 'matchClassIds',
  posted: 'incomePosted',
} as const;

/**
 * Which income counts as the new grant's receipts (JPH-29 E3's "Grant income" block on step
 * 2). Until step 2 has been posted the funder's own customer is the default; afterwards the
 * selection is whatever the user left checked, including nothing.
 */
export function incomeSelections(
  v: StepValues,
  funderPartyId: string | null,
): { matchPartyIds: string[]; matchClassIds: string[] } {
  if (s(v, INCOME_FIELDS.posted) !== '1')
    return { matchPartyIds: funderPartyId ? [funderPartyId] : [], matchClassIds: [] };
  return {
    matchPartyIds: [...new Set(many(v, INCOME_FIELDS.parties).filter(Boolean))],
    matchClassIds: [...new Set(many(v, INCOME_FIELDS.classes).filter(Boolean))],
  };
}
