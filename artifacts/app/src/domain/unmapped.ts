/**
 * The one definition of "unmapped program expense" (JPH-25 A3).
 *
 * An allocated amount counts when, and only when:
 *   - it posts to an expense account (Expense, COGS, OtherExpense),
 *   - its allocation status is `ok` (a conflict of either kind is a conflict, never a gap),
 *   - it belongs to a program whose functional category is `program`
 *     (management & general and fundraising are non-grant by nature),
 *   - it has no grant budget line, and
 *   - its transaction date falls inside the period being shown.
 *
 * The dashboard card, the reconciliation check and the coverage total all call
 * `unmappedProgramExpense` over the same period, so they cannot disagree.
 */

export const EXPENSE_ACCOUNT_TYPES = ['Expense', 'COGS', 'OtherExpense'] as const;

export function isExpenseAccountType(type: string): boolean {
  return (EXPENSE_ACCOUNT_TYPES as readonly string[]).includes(type);
}

export interface UnmappedCandidate {
  amountCents: number;
  status: string;
  programId: string | null;
  grantBudgetLineId: string | null;
  program: { functionalCategory: string } | null;
  sourceLine: {
    transactionId: string;
    account: { type: string };
    transaction: { txnDate: Date };
  };
}

export interface Period {
  from: Date;
  to: Date;
}

export function inPeriod(txnDate: Date, period: Period | null | undefined): boolean {
  if (!period) return true;
  return txnDate >= period.from && txnDate <= period.to;
}

/** Is this allocated amount an unmapped program expense inside `period`? */
export function isUnmappedProgramExpense(
  piece: UnmappedCandidate,
  period?: Period | null,
): boolean {
  return (
    piece.status === 'ok' &&
    piece.programId !== null &&
    piece.program?.functionalCategory === 'program' &&
    piece.grantBudgetLineId === null &&
    isExpenseAccountType(piece.sourceLine.account.type) &&
    inPeriod(piece.sourceLine.transaction.txnDate, period)
  );
}

export interface UnmappedSummary {
  /** Integer cents. */
  cents: number;
  /** Distinct QuickBooks transactions behind `cents`. */
  transactions: number;
}

/** Dollars and distinct transactions of unmapped program expense inside `period`. */
export function unmappedProgramExpense<T extends UnmappedCandidate>(
  pieces: readonly T[],
  period?: Period | null,
): UnmappedSummary & { pieces: T[] } {
  const matched = pieces.filter((p) => isUnmappedProgramExpense(p, period));
  return {
    cents: matched.reduce((n, p) => n + p.amountCents, 0),
    transactions: new Set(matched.map((p) => p.sourceLine.transactionId)).size,
    pieces: matched,
  };
}
