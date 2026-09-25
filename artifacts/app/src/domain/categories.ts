/**
 * Category keys for activity × category budgets (JPH-21). A cell is addressed
 * by (activity, categoryKey); rules of dimension "category" resolve a line to
 * one of these keys. Keys are stable identifiers; labels are display only.
 */
export const CATEGORY_KEYS = [
  'practitioners',
  'facility_admin',
  'coordinator',
  'program_support',
  'food',
  'supplies',
  'other',
] as const;

export type CategoryKey = (typeof CATEGORY_KEYS)[number];

const LABELS: Record<string, string> = {
  practitioners: 'Practitioners',
  facility_admin: 'Facility use & administrative',
  coordinator: 'Coordinator',
  program_support: 'Program support',
  food: 'Food & beverage',
  supplies: 'Supplies',
  other: 'Other',
};

export function categoryLabel(key: string | null | undefined): string {
  if (!key) return '—';
  return LABELS[key] ?? key;
}

export const categoryKeyPattern = /^[a-z][a-z0-9_]{0,39}$/;
