/** Serializable contracts shared by the server pages, the API route and the builder island. */
import type { RuleLabels } from '@/domain/describe-rule';

export interface BuilderOption {
  id: string;
  /** What the picker shows, e.g. "Rent 6210" or "Youth Meals (YM)". */
  label: string;
  /** What the sentence says when it differs from the label, e.g. "Rent". */
  name?: string;
}
export interface AccountOption extends BuilderOption {
  /** Expense-type accounts are listed by default; others sit behind "Show all accounts". */
  expense: boolean;
}

export interface BuilderOptions {
  /** Crosswalk target: grant › budget line. */
  grants?: Array<{ id: string; name: string; lines: BuilderOption[] }>;
  /** Grant rule targets. */
  lines?: BuilderOption[];
  activities?: BuilderOption[];
  categories?: BuilderOption[];
  programs: BuilderOption[];
  accounts: AccountOption[];
  classes: BuilderOption[];
  locations: BuilderOption[];
  parties: BuilderOption[];
  txnTypes: string[];
}

const toMap = (xs: BuilderOption[]) => new Map(xs.map((o) => [o.id, o.name ?? o.label]));

/** describeRule labels from the option lists (works on the server and in the island). */
export function labelsFromOptions(o: BuilderOptions): RuleLabels {
  return {
    programs: toMap(o.programs),
    accounts: toMap(o.accounts),
    classes: toMap(o.classes),
    locations: toMap(o.locations),
    parties: toMap(o.parties),
  };
}

/** One matched transaction in the preview panel (dates as ISO strings so it can travel as JSON). */
export interface PreviewRow {
  id: string;
  date: string;
  name: string | null;
  account: string;
  description: string | null;
  amountCents: number;
}

export interface RulePreviewData {
  count: number;
  totalCents: number;
  rows: PreviewRow[];
  /** "Jan 1 – Mar 31, 2026" — the app period from src/domain/period.ts. */
  periodLabel: string;
  /** Superset warning (B4), or null. */
  warning: string | null;
}
