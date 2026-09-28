/**
 * UI vocabulary (JPH-25 binding rule 1). The CPA using this app thinks in QuickBooks terms,
 * so every label, heading, column, helper text, banner, check name and empty state uses these
 * words instead of the engine's. Prisma models, routes, query params and fixtures keep their
 * internal names — this map is copy only.
 *
 * Never shown to the user: "pieces", "fingerprint", "run <hash>", "config hash", "file hash"
 * (hashes go behind a collapsed "Technical details").
 */
export const TERMS = {
  /** Party / parties / payees → the QuickBooks "Name" (customer or vendor). */
  name: 'Name (customer or vendor)',
  names: 'Names (customers and vendors)',
  namesShort: 'Names',
  /** Revenue matcher — parties. */
  funderCustomerNames: "Funder's QuickBooks customer name(s)",
  /** Revenue matcher — classes. */
  incomeClasses: 'Income classes for this grant (optional)',
  /** Pieces → allocated amounts. */
  allocatedAmounts: 'Allocated amounts',
  allocatedAmountsLower: 'allocated amounts',
  allocatedAmount: 'allocated amount',
  /** Source lines / transaction lines / member lines → transactions. */
  transactions: 'Transactions',
  transactionsLower: 'transactions',
  transaction: 'transaction',
  /** Budget "cell". */
  cell: 'Activity × category',
  cellLower: 'activity × category',
  /** Fingerprint → decisions survive re-import. */
  decisionsSurvive: 'decisions survive re-import',
  /** Stale → needs update. */
  needsUpdate: 'Needs update',
  needsUpdateLower: 'needs update',
  /** Hidden identifiers live under this collapsed heading. */
  technicalDetails: 'Technical details',
  crosswalk: 'Crosswalk',
  crosswalkSubtitle: 'Which expenses count toward each grant budget line',
  /** Allocation rules → shared cost splits. */
  sharedCostSplits: 'Shared cost splits',
  sharedCostSplitsLower: 'shared cost splits',
  sharedCostSplit: 'shared cost split',
  /** BvA → Budget vs. Actuals. */
  budgetVsActuals: 'Budget vs. Actuals',
  /** JPH-29 E2: "Funder view" / "Working view" → the two views of Budget vs. Actuals. */
  funderView: 'Funder view (budget as awarded)',
  internalView: 'Internal view (how we track it)',
  /** JPH-29 E3: the one block that replaces the six "which QuickBooks thing" fields. */
  howQuickBooksTracks: 'How QuickBooks tracks this grant',
  grantIncome: 'Grant income',
  incomeClassesShort: 'Income classes (optional)',
  /** JPH-28 D5: compute run / recompute → calculation (the word appears in the audit log only). */
  calculation: 'Calculation',
  calculations: 'Calculations',
  recalculateNow: 'Recalculate now',
  /** Reconciliation checks → health checks. */
  healthChecks: 'Health checks',
  activityLog: 'Activity log',
  closeChecklist: 'Close checklist',
} as const;

export type TermKey = keyof typeof TERMS;

/**
 * Health-check names as shown to the user (keys are the stored check names). The six names are
 * binding (JPH-28 D5); `grant_line_states` and `stats` have no ticket name and are worded to
 * match (QUESTIONS.md, JPH-28).
 */
export const CHECK_LABELS: Record<string, string> = {
  sum_per_source_line: 'Totals match source',
  trial_balance: 'Trial balance provided',
  unassigned_program: 'Every allocation has a program',
  unmapped_program_expense: 'Program expense mapped to a grant',
  crosswalk_conflicts: 'No overlapping rules',
  grant_revenue_sanity: 'Grant income inside grant period',
  grant_line_states: 'Grant decisions match transactions',
  stats: 'Calculation statistics',
};

export function checkLabel(name: string): string {
  const known = CHECK_LABELS[name];
  if (known) return known;
  const label = name.replaceAll('_', ' ');
  return label.charAt(0).toUpperCase() + label.slice(1);
}

/** Labels for the engine's run statistics object (keys are the stored field names). */
export const STAT_LABELS: Record<string, string> = {
  lines: 'transactions',
  pieces: 'allocated amounts',
  allocationConflicts: 'shared cost split conflicts',
  crosswalkConflicts: 'crosswalk conflicts',
  unassigned: 'without a program',
  unmapped: 'unmapped',
};

/** "35 transactions · 65 allocated amounts · …" for a stats-like object. */
export function describeStats(value: unknown): string {
  if (!value || typeof value !== 'object') return String(value ?? '');
  return Object.entries(value as Record<string, unknown>)
    .map(([k, v]) => `${String(v)} ${STAT_LABELS[k] ?? k.replaceAll('_', ' ')}`)
    .join(' · ');
}

/**
 * Review-queue reasons as shown to the user (keys are the engine's `REVIEW_REASONS`). Only the
 * one that says "cell" changes; the others are already plain English (JPH-27 AC13).
 */
export const REVIEW_REASON_LABELS: Record<string, string> = {
  'no budget cell': `no budget line for that ${TERMS.cellLower}`,
};

export function reviewReasonLabel(reason: string | null | undefined): string {
  if (!reason) return 'needs review';
  return REVIEW_REASON_LABELS[reason] ?? reason;
}

/** Nouns the review queue must never show (JPH-27 AC13); "cell" is matched as a whole word. */
export const REVIEW_FORBIDDEN_TERMS = ['member line', 'fingerprint'] as const;
export const CELL_NOUN_PATTERN = /\bcells?\b/i;

/** Words that must never reach rendered HTML; the AC13 copy test asserts on this list. */
export const FORBIDDEN_TERMS = [
  'pieces',
  'Parties',
  'Payees',
  'Revenue matcher',
  'member line',
  'fingerprint',
  'config hash',
  'Lines → pieces',
] as const;

/** "run cmug9r7p"-style identifiers must never be shown. */
export const RUN_HASH_PATTERN = /\brun [a-z0-9]{8}\b/;
