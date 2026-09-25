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

14. **Decision fingerprints are `Transaction.externalId#lineNumber`.** Report exports produce one
    line per transaction, but the CSV importer can produce several lines per transaction; keying by
    the transaction alone would collapse sibling decisions onto one line. No decisions existed before
    this change, so nothing was migrated.
15. **Re-seeding never overrides a reviewer.** `seed:pilot` skips any line that already carries an
    active state decision (or at-risk flag) of any origin, so a reviewer who supersedes a seeded
    decision keeps their answer across re-runs. Confirming a reversal pair also requires both halves to
    post to the same account, matching the proposal logic.
16. **A grant with decision history is archived, never hard-deleted.** Same rule as for grants with
    compute runs or scoped imports.
17. **The state invariant checks set equality per line.** Beyond count and sum, every state row must
    reference a current expense member line and carry its amount, so a swapped line or two offsetting
    wrong amounts cannot pass.

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

## JPH-21 — Budget model, grant rules, review queue, pilot seed

### Decisions taken (revisit if wrong)

1. **Culinary Staff rule deviates from Appendix 1.** Appendix 1 maps Culinary Staff to "Service
   Providers + payee Celeste Norwood". With only that rule, Culinary Staff lands at 800.00 instead of
   the Tier 1 160.00, and Practitioners at 7,740.00 instead of 7,100.00. The seeded rule matches
   Service Providers lines whose payee is Celeste Norwood **or** Luna Abruzzi **and** whose
   description says "culinary trainer"; the remaining Celeste Norwood lines fall through to the
   Practitioners rule. That reproduces the workbook exactly. The rule lives in
   `fixtures/pilot/seed.json` (Salah, priority 70) and can be edited on the grant's Rules page.
2. **Leah's "from September" rule uses `dateFrom = 2026-09-01`.** The seven pre-September Leah
   payroll lines (2026-03-26 … 2026-06-16, 1,188.41) therefore miss every rule and reach the queue
   as "no rule match", as AC1 requires. Neither D1-A nor D1-B is seeded; the D1 test records both,
   D1-B superseding D1-A, and the app leaves the seven lines waiting for the client's answer.
3. **Opioid is one grant, one award (20,000.00).** The export carries two deposits (16,050.00 and
   3,950.00) and spans January 2025 – September 2026; both are treated as receipts of one award
   with the grant period set to the export range. If the funder treats them as two consecutive
   awards, the second becomes a separate grant with its own budget.
4. **Program Support is a working line matched by payroll accounts + name.** Appendix 2 shows Leah
   and Cole payroll under Program Support for Sober Socials (187.44) and Teen Monthly (496.09). The
   category rule matches Salaries / Payroll Tax / Camp payroll accounts whose description names
   Leah or Cole; the activity comes from the activity rules (Fun Friday / teen → Teen Monthly,
   Friendsgiving / Game night / sober social → Sober Socials). One November 2025 Salaries line
   ("8.52x22") has no activity keyword and is assigned to Sober Socials × Program Support by a
   seeded manual decision, as Appendix 1 does. Coordinator payroll (Kira, the "adjustment to
   Opioid Grant" entries) and Leah's conference payroll are excluded by a seeded decision with
   reason "pending effort charge (phase 3)": the workbook charges coordinator effort in Phase 3
   and does not count booked payroll in the direct grid, so the five-activity direct total stays
   7,226.54. Whether Leah's conference payroll should instead count as Conference program support
   is a client question.
5. **Food & Supplies are two category keys.** The funder budget shows one "Food & Supplies"
   column; the workbook Tier 1 grid splits food and supplies, and both are asserted separately
   (AC4). The funder category row sums both keys.
6. **Overhead is a working line, not a category.** The 10% de minimis overhead journal entry
   (account Overhead Expense) is assigned to the OVERHEAD working line under Facilitation & Admin
   so it never enters the activity × category grid.
7. **The grant stage matches expense lines only, with no date window of its own.** Income and
   balance-sheet lines are members but neither assigned nor queued; the grant's start/end dates
   are informational until Phase 3. Rule-level `dateFrom`/`dateTo` remain available (used by
   the Leah rule).
8. **Membership comes from the import scope.** Neither export carries the Salah class ("Trauma
   Grants") or the Opioid project column, so the seed records the class / project name on the
   grant as documentation and relies on the scoped import for membership.
9. **Reversal-pair proposals are heuristic; confirmation is manual.** Pairs are proposed for
   same-account, equal-and-opposite member lines. Salah proposes ±113.96 (queued), ±100.00 (both
   halves already assigned to Practitioners by rule), and two further pairs (±75.00 and ±250.00,
   both assigned to Practitioners) that net to zero and were left unconfirmed. Opioid proposes one
   ±207.02 pair ("camp games expense": an expense and the journal entry reversing it) whose two
   halves are the only Opioid lines needing review; they net to zero and are left for the client.
10. **Salah grant period assumed 2026-03-13 – 2027-02-28.** The ticket gives the award date and a
    twelve-month term; the exact end date was not stated.
11. **Funder-category vs working-line mismatches surface as warnings, never as adjustments.**
    Working lines total 50,000.61 against a 50,000.00 funder budget (Facilitators & Trauma
    Informed lines 29,358.01 + 1,400.00 revision vs 29,400.00, and so on). The budget page shows a
    warning with the 0.61 gap (AC9); nothing rounds it away.
12. **The state invariant is a reconciliation check.** "grant line states" runs on every compute
    run; an imbalance fails the run and the previous run stays current (AC8). This adds one row to
    the dashboard's Reconciliation checks card, so the two dashboard visual baselines were
    re-captured. No other baseline changed.
13. **The database tests truncate the development database.** As in JPH-20, `pnpm test` resets
    the dev database (there is no `TEST_DATABASE_URL`); restore with `pnpm run import:csv -- --dir
    fixtures/demo && pnpm run seed:demo && pnpm run recompute` before using the preview. The new
    `pilot` Playwright project seeds both pilot grants into the demo org, runs last and alone, and
    removes everything it wrote.

### Follow-ups (out of phase)

- Phase 3 (JPH-22): grant-period date window on the grant stage, funder-format reports, decision
  export. Not started.
- Confirm or reject the ±75.00 / ±250.00 Salah pairs and the ±207.02 Opioid pair with the client;
  confirming changes no Tier 1 figure (all net to zero within one working line).
- Ask whether Leah's conference payroll belongs in Conference × Program Support or stays with the
  coordinator effort charge.
- The Grants list's "Spent" column still comes from the program-allocation stage, so the two pilot
  grants (which have no programs) show "—" there while their budget pages show the Tier 1 spend.
  Deciding whether the list should read grant-stage spend for restricted grants is a Phase 3 /
  reporting question.

### Nothing disputed

No Tier 1, Appendix 2/3 or ticket figure was changed. AC1–AC9 are asserted as integer cents in
`artifacts/app/tests/db/jph21-pilot.test.ts`; AC10 (existing golden and QuickBooks report
suites) is `tests/db/golden.test.ts` and `tests/db/qbo-report.test.ts`, unchanged. Rendered
figures are asserted on `data-cents` attributes in `artifacts/app/e2e/pilot.spec.ts`.
