# Questions and decisions log

Per-phase notes for the JPH-19 pilot. Each entry records a choice the ticket left open, the
reason, and where it can be revisited. Nothing here changes an expected value.

## JPH-20 — QuickBooks report import, grant membership, privacy guardrails

### Decisions taken (revisit if wrong)

1. **Denylist matching is whole-word, case-insensitive.** Several real first names are substrings
   of ordinary English words (the way "Ann" sits inside "annual") and one surname is inside the
   repository owner's handle, which appears in git remotes and lockfiles. Substring matching would make the
   guard permanently red on innocent files; whole-word matching keeps it useful. A term with spaces
   matches across any whitespace. Location: `artifacts/app/src/privacy/scan.ts`.
2. **The pilot exports carry a pseudonymous organization name** ("Harborlight Community
   Organization Inc.") and pseudonymous funder/payee/staff names, including the town in the Opioid
   grant's deposit memos. Rule keywords from JPH-19 Appendix 1 (program names, account names,
   vendor categories) are preserved verbatim so Phase 2 rules can be tested against the fixture.
   The real → pseudonym map lives in the git-ignored `fixtures/private/pseudonyms.json`.
   **Phase 2 seed rules must use the pseudonyms, not the real names**, or the denylist test fails.
3. **A report import never renames the organization.** The report title row names the real
   company; the adapter returns the caller-supplied org descriptor and stores the report's company
   name in `ImportBatch.reportMeta` only.
4. **Account type is inferred from the top-level section and confirmed by the user.** Exports have
   no account-type column. "Contributed income" / income-like headings → Income; everything else →
   Expense. The confirm page shows every account with a type select; overrides apply to the
   account and its sub-accounts. Accounts are keyed by their full heading path
   (e.g. `Programs:Salaries`), separate from any QuickBooks-id-keyed accounts from the CSV bundle.
5. **"Removed" detection is scoped to the grant + report date range.** A line previously imported
   for grant G inside range R that is missing from a new report for (G, R) is soft-deleted; nothing
   outside (G, R) is touched. Two grants' imports therefore never delete each other's lines (AC6).
6. **An amount correction counts as "changed", not "removed + new".** The external id includes the
   amount, so it changes when the amount changes; a `matchKey` (same key without the amount) pairs
   the new row with its predecessor and records a `SourceRowVersion` (AC4).
7. **A line two grants' reports both contain is shared.** Its mirror transaction is keyed by
   content, so both grants hold an `import_scope` membership on the same line. When one grant's
   later report drops it, that grant's membership is superseded and the transaction stays live for
   the other grant; only a line no grant's report still holds is soft-deleted. Removal candidates
   are limited to lines this grant's own reports brought in (`import_scope`), never lines it holds
   only through a class or customer rule.
8. **Membership reasons are independent.** A line can carry one active row per reason
   (`import_scope`, `class_match`, `project_match`) for the same grant; unticking a rule never
   removes what the grant's own report established.
9. **Identical rows that differ only in amount are matched in file order.** `matchKey` pairs a
   vanished row with a new one sharing date/type/num/name/description/account; when two such rows
   exist, the occurrence index follows file order, so swapping them reads as two changes rather than
   none. Acceptable for the pilot; flag if bookkeepers report noisy change counts.
10. **Grant-scope totals on the batch page are current, not per-batch.** The "Income / expense"
   figures sum the grant's active member lines inside the report range at render time, so a
   re-import with no changes still shows the totals rather than zeros.
11. **Membership for a report import is `import_scope` for every line in the file.** Class- and
   project-based membership (`class_match`, `project_match`) is maintained from
   `Grant.memberClassIds` / `Grant.memberPartyIds` on grant save and after each import; rows are
   superseded, never deleted.
12. **Report uploads are staged in the database** (`QboReportUpload`, with the file bytes) between
   the upload and confirm steps so the confirm page works without JavaScript and survives a dev
   server restart. The confirm step claims the upload atomically (`consumedAt`) so a double submit
   runs one import; consumed uploads keep their `batchId`. Purging old uploads is a follow-up.
13. **The e2e suite treats the development database as disposable**, as the existing specs already
   do (`pnpm test` truncates it; the visual spec restores the demo fixture). The report spec runs in
   its own Playwright projects after the functional ones and removes every report import it made.

### Follow-ups (out of phase)

- Purge consumed/abandoned `QboReportUpload` rows after N days.
- The Opioid export spans January 2025 – September 2026 with two grant deposits; whether that is
  one award or two consecutive ones (two grants, two budgets) is a Phase 2 question.
- Live QuickBooks Project matching (JPH-19 §9) — membership rules exist but no live source yet.
- Grant delete: a grant referenced by a report import is archived rather than deleted (consistent
  with compute runs). A "detach imports" flow was not built.
- A local commit that briefly tracked a copy of the JPH-19 ticket text (real names) under
  `.agents/outputs/` was squashed out of `main`; the directory is now git-ignored and the file was
  never pushed to GitHub. Replit's internal checkpoint refs and its backup remote still reference
  that commit; pushes to GitHub replay trees, not history, so they will not carry it. Do not push
  `main` with `--mirror`/all refs.

### Nothing disputed

No golden or ticket figure was changed. All AC1 figures (Salah expense 22,708.81, Salah income
50,000.00, Opioid income 20,000.00) are asserted as integer cents in
`artifacts/app/tests/db/qbo-report.test.ts` and on the rendered batch page in
`artifacts/app/e2e/qbo-report.spec.ts`.
