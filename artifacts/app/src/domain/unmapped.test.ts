import { describe, expect, it } from 'vitest';
import {
  isUnmappedProgramExpense,
  unmappedProgramExpense,
  type UnmappedCandidate,
} from './unmapped';

const d = (iso: string) => new Date(`${iso}T00:00:00Z`);

function piece(over: Partial<UnmappedCandidate> & { txnDate?: string; txnId?: string }) {
  const { txnDate = '2026-02-10', txnId = 't1', ...rest } = over;
  return {
    amountCents: 100_00,
    status: 'ok',
    programId: 'p-program',
    grantBudgetLineId: null,
    program: { functionalCategory: 'program' },
    sourceLine: {
      transactionId: txnId,
      account: { type: 'Expense' },
      transaction: { txnDate: d(txnDate) },
    },
    ...rest,
  } satisfies UnmappedCandidate;
}

const period = { from: d('2026-01-01'), to: d('2026-02-28') };

describe('one definition of unmapped program expense (JPH-25 A3)', () => {
  it('counts only status ok, program-category, budget-line-less expense inside the period', () => {
    expect(isUnmappedProgramExpense(piece({}), period)).toBe(true);
    // A conflict of either kind is a conflict, never a gap.
    expect(isUnmappedProgramExpense(piece({ status: 'allocation_conflict' }), period)).toBe(false);
    expect(isUnmappedProgramExpense(piece({ status: 'crosswalk_conflict' }), period)).toBe(false);
    // Management & general / fundraising are non-grant by nature.
    expect(
      isUnmappedProgramExpense(
        piece({ program: { functionalCategory: 'management_general' } }),
        period,
      ),
    ).toBe(false);
    expect(
      isUnmappedProgramExpense(piece({ program: { functionalCategory: 'fundraising' } }), period),
    ).toBe(false);
    // Mapped, unassigned and non-expense amounts never count.
    expect(isUnmappedProgramExpense(piece({ grantBudgetLineId: 'bl-1' }), period)).toBe(false);
    expect(isUnmappedProgramExpense(piece({ programId: null, program: null }), period)).toBe(false);
    expect(
      isUnmappedProgramExpense(
        piece({
          sourceLine: {
            transactionId: 't1',
            account: { type: 'Income' },
            transaction: { txnDate: d('2026-02-10') },
          },
        }),
        period,
      ),
    ).toBe(false);
  });

  it('scopes to the period on both ends and counts distinct transactions', () => {
    const pieces = [
      piece({ amountCents: 50_00, txnDate: '2026-01-01', txnId: 'a' }), // first day: in
      piece({ amountCents: 25_00, txnDate: '2026-02-28', txnId: 'b' }), // last day: in
      piece({ amountCents: 25_00, txnDate: '2026-02-28', txnId: 'b' }), // same transaction, split
      piece({ amountCents: 999_00, txnDate: '2026-03-01', txnId: 'c' }), // after: out
      piece({ amountCents: 999_00, txnDate: '2025-12-31', txnId: 'd' }), // before: out
      piece({
        amountCents: 999_00,
        txnDate: '2026-02-01',
        txnId: 'e',
        status: 'allocation_conflict',
      }),
    ];
    const feb = unmappedProgramExpense(pieces, period);
    expect(feb.cents).toBe(100_00);
    expect(feb.transactions).toBe(2);
    const march = unmappedProgramExpense(pieces, { from: d('2026-01-01'), to: d('2026-03-31') });
    expect(march.cents).toBe(1099_00);
    expect(march.transactions).toBe(3);
    // No period → the whole run (still excludes the conflict).
    expect(unmappedProgramExpense(pieces).cents).toBe(2098_00);
  });
});
