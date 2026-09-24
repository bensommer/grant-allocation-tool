# Budget vs actual and pacing definitions

- **Actual (spent):** Sum of `ok` allocated pieces in the current compute run mapped to the grant's budget lines, with expense accounts (Expense, COGS or OtherExpense), transaction dates from grant start through the as-of date. Excludes deleted transactions and crosswalk conflicts.
- **Received:** Sum of income source lines (Income or OtherIncome, positive natural credit sign) from non-deleted transactions during the grant period through as-of, whose transaction party matches a grant party or whose line class matches a grant class. If a revenue account is set, only that account qualifies. Received is separate from the award.
- **Restricted balance:** Received minus spent, only on purpose/time/both restricted grants. Negative is labelled **spent ahead of receipts**, not an error.
- **Remaining budget:** Budget minus actual, per line and total. An actual greater than its line budget always flags that line, even when the grant total is under budget.
- **Remaining award:** Award minus spent.
- **Expected spend to date:** Award multiplied by inclusive elapsed grant days divided by inclusive total grant days, rounded half-up to cents. Elapsed days clamp to zero before start and total days after end.
- **Pacing variance:** Actual minus expected; a strict greater-than comparison flags spending more than the configured over threshold above expected (default 10%), or more than the under threshold below expected (default 15%). Thresholds are configured in Settings.
