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

---

## JPH-21 → JPH-22 — Effort charges, booked-vs-charged, correcting entries

### Decisions taken (revisit if wrong)

1. **Schedule matchers must cover more than "payroll accounts + the coordinator's pseudonym".**
   The pilot's booked coordinator cost of 5,519.56 is Kira's payroll (5,376.16) **plus** the two
   "Conference Leah" payroll lines (143.40). A matcher built only from the ticket's wording misses
   the 143.40 and reads variance 0.13 instead of 143.53. The seeded Opioid schedule therefore
   matches Salaries + Payroll Tax Expense lines whose description contains "Kira", "adjustment to
   Opioid Grant" or "Conference Leah" — the same line set the Phase 2 "pending effort charge
   (phase 3)" placeholder excluded. The matchers are editable on the Effort page.
2. **Effort rounding rule.** Charge per activity = hours × count × rate × (1 + bps/10000) in
   `decimal.js`; the schedule total is rounded half-up to cents once, then distributed to activities
   with largest-remainder (ties → lowest activity sort order). That is why Sober Socials reads
   446.38 rather than the naive per-line 446.39, and why the five lines sum exactly to 5,376.03.
   Hourly rate is the explicit rate or salary ÷ 2080, displayed to 4 dp (36.0577) but used unrounded.
3. **Budget tree keeps `spentCents` transaction-only.** The ticket asks the tree's spent to include
   effort charges so page totals agree. Phase 2 AC4 asserts the non-direct cells' spent is 0, so
   instead every line/cell carries `effortCents` and `chargedCents` (= spent + effort); page totals,
   the Effort page and the JPH-22 tests use `chargedCents`. Totals agree (16,286.10); the split is
   just reported explicitly.
4. **True-up account.** The true-up moves the variance on the matched payroll account carrying the
   most booked cents (Salaries for the pilot: 5,122.16 vs 397.40 on Payroll Tax Expense). Splitting
   the variance pro rata across payroll accounts would produce two lines the client did not ask
   for; if they want a different account, change `bookedAccounts[0]` in
   `services/correcting-entries.ts` — the balance check is independent of the choice.
5. **Grant-side class / project on drafts.** The grant side of a draft is coded from the grant's
   membership class / project when one is stored, otherwise from two new grant fields,
   `qboClassName` / `qboProjectName` (the class full name / project the books use; editable on the
   grant form). The pilot seed fills them from the seed scope ("Trauma Grants" for Salah,
   "2025-2026 Opioid Grant" for Opioid) because neither export carries the grant's own class /
   project as a row. Drafting is refused with a clear message while a grant has neither, so a
   draft whose grant-side lines would post nowhere is never created. Each draft line freezes the
   exported Class / Name at draft time (`className` / `partyName`).
6. **Booked and variance.** Booked = transaction lines excluded as "replaced by effort charge"
   (i.e. the schedule's matchers) + this grant's posted true-up journal lines; lines that belong to
   a posted correcting entry are excluded with reason "posted correcting entry {code}" and never
   count as booked payroll. Variance = booked − charged. After the pilot true-up is posted the
   grant-side credit (−143.53) makes booked 5,376.03 and variance 0.00.
7. **Grant-stage precedence.** Explicit line decisions → posted-correcting-entry lines → schedule
   matchers → grant rules. So a decision on a matched payroll line still wins, and a schedule wins
   over rules, as the ticket asks. The "grant line states" invariant checks transaction-sourced
   results only; effort results (`source = effort`, no transaction line) are counted separately.
8. **Posted detection.** A report export delivers a posted journal as one row per line, and the
   importer stores each row as its own transaction. Detection therefore aggregates: every member
   Journal Entry line of the grant whose transaction memo or own description carries the draft
   code is collected, and the draft is posted when those lines sum exactly to the draft's
   grant-side amount (accounts are not compared — the code plus the total is the match). A
   mismatch — including a code posted twice — leaves the draft `drafted` for a human.
   `postedTransactionId` records the first such transaction; the grant stage excludes every
   code-carrying line (reason "posted correcting entry {code}"), not only that transaction's.
   Detection runs after every import and at the start of every recompute and is idempotent.
   Voided drafts are never matched.
9. **Draft codes and lifecycle.** `GAT-0001`, `GAT-0002`, … per org, allocated inside the save
   transaction. Drafts are drafted → posted or drafted → void (note required, timestamp kept);
   nothing is deleted. Re-drafting the same exclusion group is rejected while a non-void draft
   already covers it, and a second true-up for a schedule is rejected while one is still
   `drafted` (posting both would over-correct the grant); void first. The review-queue checkbox
   "Draft correcting entry" is on by default and only applies to `exclude`; when the default
   destination (or the grant's QuickBooks coding) is unset the exclusion is still saved and the
   page says why no draft was made.
10. **QuickBooks CSV template.** Columns follow Intuit's "Import journal entries into QuickBooks
    Online" article (URL cited in `src/reports/correcting-entry.ts`, checked 2026-09-25): Journal
    No., Journal Date, Account Name, Journal/Description, Debits, Credits, Name, Class, Location;
    dates MM/DD/YYYY, one row per line. Nothing is sent to QuickBooks.
11. **Phase 2 pilot test helper touched, no expected value changed.** `stateSnapshot` in
    `tests/db/jph21-pilot.test.ts` now filters to `source = 'transaction'` because effort results
    have no transaction line; every assertion and figure in that file is unchanged.
12. **Default destination** lives in the Org settings JSON (`defaultDestination: { classId,
    partyId }`) via the settings service and is edited on `/settings`. Either a class, a project /
    customer, or both may be set; drafting requires at least one.
13. `zodErrors` moved to `src/lib/zod-errors.ts` (re-exported from `lib/forms`) so
    services used by Playwright specs no longer pull `next/navigation` into a plain Node process.
14. **Posting tests round-trip through the CSV.** The generated posted fixtures read the
    grant-side rows back from the export CSV (Class / Name identify them) and append them to the
    report export as journal rows, one per line, so the export's coding is what gets tested. A
    two-account reclass test covers the one-row-per-line aggregation.
15. **An active schedule must have a restrictive payroll matcher** (an account, an account range,
    or description text). Empty matchers match every line, so an active blank schedule would
    exclude the grant's whole expense side as "replaced by effort charge". Inactive schedules may be
    saved without matchers; activating one requires them.
16. **Class full names win over ledger leaf names.** A ledger `TrackingClass` row only knows its
    leaf segment ("Trauma Grants"), while QuickBooks matches journal imports on the full name
    ("Programs:Trauma Grants"). `qboClassName` / `qboProjectName`, when set, are what the CSV
    carries; the membership row's name is the fallback.
17. **Draft codes match as whole tokens.** `GAT-0001` in a memo or description does not match
    `GAT-00010` or `XGAT-0001`; the same check is used by posted detection and by posted-line
    loading in the grant stage.

### Follow-ups (out of phase)

- Ask the client whether the "Conference Leah" payroll lines (143.40) belong to the coordinator
  effort schedule (as the workbook's 5,519.56 implies) or should be a separate Conference charge.
- Confirm the true-up account choice (Salaries) and whether the payroll-tax share should move too.
- Dating effort occurrences by period and per-period true-ups are Phase 4 (JPH-23).
- After `pnpm test`, the dev database holds the last test org; the demo restore recipe in
  `replit.md` now starts with a truncate.

### Nothing disputed

JPH-19 §6 F–G and JPH-22 agree on every figure. AC1–AC9 are asserted as integer cents in
`artifacts/app/tests/db/jph22-effort.test.ts`; rendered figures on `data-cents` attributes in
`artifacts/app/e2e/pilot.spec.ts`. Posted fixtures are generated in memory inside the tests from
the tracked exports, never hand-written.

## JPH-22 → JPH-23 — Periods, tie-out, grant workspace, rollforward, parity

### Assumptions logged as instructed

1. **Salah grant dates 2026-03-13 → 2027-02-28** (seeded as given; the workbook does not state
   them). Everything date-derived on the Salah workspace — % of time elapsed, projected spend at
   grant end, months left (5.3 at 9/22/2026), remaining per month — moves if these dates are wrong.
2. **Salah lines are all `direct`**, matching how she presents the grant. Question for the client:
   should the Kira and Leah payroll lines on Salah be `staff` instead? If yes, the rollforward
   moves 2,530.47 (D1-A) or 1,342.06 (D1-B) from "released direct" to "released staff"; the ending
   balance does not change.

### Decisions taken (revisit if wrong)

1. **Reported periods are entered once and never recomputed.** A reported snapshot is a row with
   `source = reported`; recompute, locking and re-locking never touch it. Re-reporting the same
   period supersedes the earlier rows (`supersededAt`) rather than deleting them. The books-computed
   figure for the same window appears beside it as drift and never replaces it.
2. **`PeriodLock` is org-wide, not per grant.** Locking a period freezes a computed snapshot for
   every grant that has a released or received amount in that window. The reported FY2025 snapshot
   is attached to an org-level FY2025 lock, so a second grant with FY2025 activity would get a
   computed snapshot on the same lock, not a reported one, unless it is also entered by hand.
3. **Beginning balance = received − released over all earlier periods**, reported snapshots first,
   computed ones otherwise, and the books for windows with neither. Current-period release per
   class = released to date − released in earlier periods. Staff drift is shown as "not computed":
   effort charges carry no dates, so "current-period staff" is total staff to date − prior reported
   staff and cannot be checked against the books per period.
4. **Tie-out is green only when nothing is waiting.** Green = needs-review cents are 0 **and** every
   line still in the queue is one half of a proposed reversal pair (so the Opioid ±207.02 pair,
   which nets to 0.00, does not block the check). Salah before D1 shows coded 22,708.81 with
   1,188.41 waiting and no green; after either D1 branch it is green. Effort charges are their own
   line in the panel and are added to "charged", never mixed into the coded-to-grant total.
5. **Release classes** are a column on the budget line (`direct | staff | overhead`), seeded as the
   ticket lists them; Opioid Coordinator and Program Support are `staff`, Facility/Admin `overhead`.
6. **Activity grid arithmetic.** Remaining per remaining occurrence = remaining ÷ (planned −
   completed), rounded half-up, blank when planned − completed ≤ 0. Food and supplies share one
   column because the funder budget has one line for them. Over-budget cells stay on their own row;
   category totals are plain sums of the rows, so "Coordinator 876.97 remaining in total" is the
   net of rows that are individually over and under.
7. **Working view.** Months left = inclusive days from as-of to the grant end ÷ (365.25 / 12), one
   decimal, from the grant dates alone; remaining per month = remaining ÷ months left, half-up.
   The forecast strip reads planned entries from the URL (`count × rate × hours`) so it works
   without JavaScript; nothing is stored.
8. **Rollforward.** One column per restricted fund, a totals column and a check row (beginning +
   received − released − ending, per column and in total). The Salah column carries a visible note
   whenever pre-September Leah lines are still waiting or were decided under D1-A, linking to the
   decision. The XLSX writes formulas for the ending and check rows and for the totals column; the
   AC4 test poisons the cached values and lets LibreOffice recalculate to prove the formulas, not
   the caches, produce the AC3 endings.
9. **Parity report.** `pnpm parity:report` reads the private workbook's cached values and
   `fixtures/private/parity-map.json`, and writes only `fixtures/private/parity.md`; it skips
   cleanly when either private file is missing and refuses to write to any path git tracks (both
   are tested). Every row must carry a reason before anything is read. App-side metric keys are a
   small colon-separated grammar (`<grant>:budget:<CODE>:charged`, `<grant>:rollforward:ending`,
   `<grant>:tieout:needsReview`, …; documented at the top of `src/services/parity-metrics.ts`), so
   adding a workbook cell is a map entry, not code. Nothing from the workbook is printed to the
   terminal.
10. **Parity reasons in use:** `matches` (including seven cells whose formula result the workbook
    never cached, read as 0.00), `D1-A` (the app releases the pre-September Leah pay to the Leah
    line; she left it unreleased), `largest-remainder rounding` (the app scales the funder budget to
    the 50,000.00 award; her typed total carries the 0.61 overage), `her cross-row formula` (E43
    nets the Mother's Exhaustion overage into Teen Monthly; the app keeps each activity on its own
    row), `half-up rounding of her payroll allocation formula`, and `reported vs. books` (the FY2025
    snapshot of record). The tie count depends on the D1 state of the seeded data: 86 rows,
    73 tie exactly after D1-A (13 differ with a stated reason), 78 tie before D1 (8 differ),
    0 unresolved either way.
11. **AC2 finding recorded in the parity report:** the FY2025 direct gap of −187.66 is one November
    2025 staff payroll line (187.44) she counted as direct plus 0.22 of whole-dollar rounding.

#### Design pass (2026-09-25) — 22 decisions from the design review, applied as written

12. **AC6 revised: a proposed reversal pair is not green.** The ticket read Opioid's ±207.02 pair
    as "counted as paired" and therefore green. The design decision is that green means *nothing
    waiting for a reviewer*, and a proposed pair still needs one. The tie-out now has three states:
    `clean` (green check), `pairs` ("N pair(s) to confirm (nets $0.00)" — amber, no red because the
    released figure does not move) and `open` (lines waiting, the first three shown inline, oldest
    first). Opioid seeds as `pairs`; confirming the pair on the review queue and recomputing turns
    it green. `tests/db/jph23-rollforward.test.ts` and `e2e/pilot.spec.ts` AC6 assert the amber
    state first and then the green one — the figures (5,376.03 effort, 16,286.10 charged, 0.00
    needs review) are unchanged. The rollforward note "coded but not yet released" is only written
    in the `open` state, since a pending pair nets to zero.
13. **Overview header:** two lead figures (restricted balance; spent vs. award with a paired
    time/spend bar and "N pts ahead of/behind pace · M months left"), four quiet ones. Colour
    appears only when pacing is outside the org thresholds or a line is over budget.
14. **Tie-out as a mini ledger:** assigned + excluded + needs review = coded, then effort and
    charged, zeros as 0.00; excluded-by-reason lives in a collapsed details block. Print layout at
    `/grants/[id]/tie-out/pdf`.
15. **Tabs grouped** Report | Work | Close, with the needs-review count as a badge on Review.
16. **Working view:** pacing callout with months left; the forecast strip starts with three blank
    rows and "Add row" is a GET re-render (no JS); an empty forecast says so instead of showing a
    zero table.
17. **Activity grid:** a column whose name joins two costs ("… & …" / "… and …") gets a footnote
    that it is one funder budget line (a heuristic on the name, not pilot-specific code); no
    per-occurrence figure renders as an em dash titled "none remaining"; over-budget cells carry
    an "over" chip; the category-total row is styled distinctly and footnoted "net of rows over
    and under budget".
18. **Periods:** reported rows are marked 🔒 Reported with muted, read-only figures; only the note
    is editable inline (`updateReportedPeriodNote`, audited, figures untouched). Drift is
    introduced as "Informational: books vs. what was reported. Not an error.", its difference
    column is neutral grey, and staff shows "Not computed¹" with the footnote explaining why.
19. **Rollforward:** GET presets — fiscal year to date (default), last closed period,
    grant-to-date (earliest active grant start → today) — plus custom from/to; presets fall back to
    the fiscal year with a banner when there is no closed period or no grant. The check row is a
    muted "0.00 ✓" when it ties and red otherwise; decision notes are numbered footnotes on the
    fund's direct-released cell with the note under the table (no banner); zeros print as 0.00.
    Print layout at `/grants/rollforward/pdf`; "Rollforward →" links from Restricted funds and
    each grant's Periods tab.
20. **Rollforward XLSX mirrors her tab cell for cell:** fund headers on row 7 from column C,
    beginning balance on row 8 (period start in A, "Restricted Grant Balance" in B), "Grants
    Received" on row 10, Direct Expenses / Staff Costs / Overhead as *negatives* on rows 11–13,
    "Current" / "Restricted Grant Balance" on row 15 as `=SUM(C8:C13)`, a Total column of SUMs and
    the check beside it as `=ROUND(SUM(G8:G13)-G15,2)`. The AC4 LibreOffice test reads these
    positions from `ROLLFORWARD_LAYOUT`; the figures asserted are unchanged.

### Follow-ups (out of phase)

- **Date effort occurrences per period** so staff drift and per-period staff releases can be
  computed instead of derived by subtraction.
- Ask the client whether the Salah Kira/Leah lines should be `staff` (assumption 2 above).
- Confirm the Salah grant dates (assumption 1 above).
- Tie-out "green" interpretation (decision 4): confirm that an unresolved reversal pair that nets
  to zero should not block the check.
- LibreOffice recalculation of exceljs workbooks needs `OOXMLRecalcMode = 0` (always recalculate)
  in the profile's registrymodifications; the AC4 test sets this in a throwaway profile. Anyone
  reproducing AC4 by hand must do the same or they will read the cached values.
- Per-grant period locks, if a grant ever needs to close on a different calendar from the org.
- A rollforward window that *contains* a closed period (rather than starting after it) uses the
  ticket's formula — released to date − released before the window — so the closed stretch is
  read from today's books, not from its snapshot. Confirm whether such windows should instead
  splice the snapshot in; today the app only guarantees the snapshot when the window starts at or
  after the period's end. Overlapping locks are refused at creation so no day is counted twice.
- Reopening a period (deleting its lock on Settings → Periods) drops that period's computed
  snapshots; a period carrying reported figures refuses to reopen. The database also refuses
  (`RESTRICT`) to drop a lock that still has snapshots.

### Nothing disputed

JPH-19 §6 H–L, §7 and JPH-23 agree on every figure. AC1–AC8 are asserted as integer cents in
`artifacts/app/tests/db/jph23-rollforward.test.ts`, `tests/db/jph23-workspace.test.ts`,
`src/domain/periods.test.ts` and `src/reports/parity.test.ts`; rendered figures on `data-cents`
attributes in `artifacts/app/e2e/pilot.spec.ts`. AC9: every earlier phase suite and the JPH-7
golden suite still pass.

## JPH-23 → JPH-30 — Phase 0: one set of grant figures

### Decisions taken (revisit if wrong)

1. **Received is not windowed the same way in both modes.** The ticket says "existing matcher
   logic unchanged in both modes". In crosswalk mode received is still clipped to the grant
   period (the JPH-7 golden 6,000,000 / 2,500,000 depend on it); in membership mode it stays
   unclipped (member income lines, or the matcher, through as-of), which is what the pilot pages
   computed before and what keeps Salah's 5,000,000 received. If the client wants one rule, the
   crosswalk clip is the one to drop — say so and the JPH-7 numbers move.
2. **BvA budget = current budget (original + revisions).** Before this phase the BvA page and
   report compared spend to the *original* line budgets while the pilot pages used current. One
   figure per line now: current. No demo or pilot expected value changed because the demo fixture
   has no revisions and the pilot tests asserted current already.
3. **Funder-view total budget when the grant has no funder categories** is the working-line
   total (`totals.budgetCents`), not 0. Demo grants have no categories, so the old total row read
   "$0.00 budget, 100% used". Pilot grants have categories, so their funder totals are unchanged;
   the private parity report reads the same field.
4. **Rollforward excludes unrestricted gifts.** The ticket's golden total ending (2,386,589) is
   Culinary + Youth Meals only; the page is titled "Restricted grants rollforward" and the
   Restricted Funds page already omits Rivera. `rollforward()` now filters
   `restrictionType != 'unrestricted'`. Pilot grants are all restricted — their columns, endings
   and check row are unchanged. The Rivera column (received 30,000, ending 30,000) that used to
   appear is the only visible difference.
5. **An unrestricted gift is "not paced".** AC2 says "Under pace: 100.0%" must appear nowhere on
   the demo fixture, but Rivera (unrestricted, no spend) legitimately reads 100 % behind a
   straight line. The domain already excluded unrestricted grants from the pacing *flag*; the
   list chip / BvA status / overview card now say "Unrestricted · not paced" for them
   (`figures.paced`). The pace object is still computed, so nothing else moves.
6. **Effective tracking mode = column OR derived signals.** The migration backfilled
   `Grant.trackingMode` once; a grant that later gains members/class/project ids/a scoped
   QBO-report import is treated as membership on read even if the column still says crosswalk,
   and the grant form writes the column on save. Pilot grants therefore show
   "Tracked by QuickBooks class/project" without a second backfill.
7. **Crosswalk-mode windows.** Spent = crosswalk pieces inside the grant period and ≤ as-of;
   needs-review and effort are 0 by definition (no member lines). Membership-mode spent = dated
   lines ≤ as-of plus *all* effort charges (effort carries no date), exactly as the pilot pages
   computed before.

8. **A staged report upload is not a membership signal.** The first backfill and the read-time
   derivation counted every `QboReportUpload`, including reports uploaded and never confirmed.
   Only uploads that produced an import batch count now, and a data-only follow-up migration
   puts any grant flipped by a staged upload back on crosswalk when nothing else says
   membership.

### Follow-ups (out of phase)

- **Membership-mode BvA detail.** For a membership grant the BvA page's actual now includes
  undated effort charges and member lines outside the grant period (through as-of), but its
  month columns cover the grant period only and its drill-down links open `/reports/lines`,
  which still reads crosswalk AllocatedLines. The total is right; the supporting detail is
  not yet membership-aware. Phase E (or a small follow-up) should point those links at the
  member-line audit and show an "undated / out of period" reconciliation row.
- Phase E regroups the pilot tabs; the crosswalk notice on Review/Rules/Effort/Entries/Periods
  is a stop-gap and links to Edit grant, where the class/project/member fields already live.
- The Rollforward "grant-to-date" preset also ends at books-through now; a custom `?to=` past
  books-through still works and drops the "books through" tag from the subtitle.
- Visual baselines for the grant overview and rollforward pages were regenerated (badge, tie-out
  text for crosswalk grants, "books through" subtitle, no Rivera column).

### Nothing disputed

Demo golden numbers (JPH-7) and pilot golden numbers (JPH-21/22/23) are unchanged; no expected
value was edited. AC7 lives in `src/domain/grant-figures.test.ts` + `tests/db/jph30-figures.test.ts`,
AC8 in `src/domain/grant-figures.source.test.ts`, AC1–AC6 in `e2e/jph30-figures.spec.ts` and the
badge asserts in `e2e/pilot.spec.ts`.

## JPH-30 → JPH-25 — Phase A: audit fixes

### Preflight

- The full e2e run on main was green except one cross-project flake: `reports.spec.ts` "GET builder,
  XLSX formulas and cached totals" in `chromium-nojs` read a grand total of 7,651,860 while the
  `chromium` project (which runs concurrently and creates grants/recomputes) was mid-mutation. It
  passes alone and on rerun; no expected value was touched. Consider serializing the two
  functional projects (`fullyParallel: false` is already set; the projects still overlap).

### Decisions taken (revisit if wrong)

- A1 as-of cookie: server components cannot set cookies and the as-of forms are plain GETs, so the
  `gat_asof` cookie is written by `src/proxy.ts` whenever a request carries a valid `?asOf=`.
  A malformed `?asOf=` still errors (the user typed it); a malformed cookie is ignored.
- A1 `resolveAsOf(searchParams, cookies, org)`: `org` is `{ fiscalYearStartMonth, booksThrough }`
  so the domain function stays pure; `src/lib/period.ts` (`currentPeriod`, `currentRange`) loads
  both and the cookie jar. Export route handlers keep reading `asOf`/`from`/`to` from their URL —
  every export link on a page now carries the page's effective dates.
- A1 `/allocation` is listed but has no as-of/from/to parameters and shows no dated figures
  (it is the shared-cost-split rule list), so nothing to wire; no PeriodSubtitle added there.
- A1 the as-of pages (dashboard, restricted, BvA, funder, working) show `[fiscal year start, asOf]`
  in the PeriodSubtitle as the ticket specifies, even though their balances are cumulative to the
  as-of date; the range names the fiscal year the as-of falls in.
- A1 `/crosswalk/matrix` still defaults to the books-through quarter and `/crosswalk/lines` to
  "all dates" — neither is in the A1 list and the matrix's quarter default is a deliberate
  screen-size choice; flag if the binding rule should override it.
- A1 Rollforward "Fiscal year to date" = `defaultRange(asOf)`; its `to` therefore follows
  `?asOf=`/cookie instead of always books-through (the "books through" tag still shows when they
  coincide). The existing JPH-30 AC4 test is unchanged and green.
- A2/A3 Coverage total row sums program-category rows only (that is where "unmapped" can exist),
  so Total expense / Mapped / Unmapped / Conflict tie across the row and Unmapped = the dashboard
  card = the reconciliation check (216,000). A second, muted tfoot row "Non-grant (management &
  general, fundraising)" carries the M&G/FR expense (1,382,450) with "n/a — non-grant" so the
  page still accounts for every expense dollar.
- A3 reuses `Program.functionalCategory` (already `program | management_general | fundraising`,
  exposed on the program form); no new field.
- A3 the reconciliation check counts distinct **transactions** behind the unmapped dollars, which
  is 6 on the demo fixture, not the 25 in the ticket's example text ("25" was the old allocated-
  amount count the check used to print). The check reads "Unmapped program expense · $2,160.00
  across 6 transactions"; the AC4 test asserts the dollars and the sentence shape, not "25".
  The check stores `cents` and `transactions` on the run so the dashboard renders a data-cents.
- A2 Funder view and Working view Total rows were already numeric on the demo grant; they now
  live in `<tfoot>` and render `$0.00` instead of "—" for an empty grant (the "—" the audit saw).
- A4 The App Router gives the root layout no props from the page, so the "breadcrumbs prop" is a
  pathname resolver (`src/lib/breadcrumbs.ts`) that the layout calls once: sidebar group › item ›
  route tail, with entity names looked up by id. Trail depth: dashboard 2 ("Overview › Dashboard"),
  list pages 1 ("Grants"), grant tabs 3, import batch 3, coverage 3. The header trail is hidden
  below the `lg` breakpoint as before. `e2e/nav.spec.ts` header-context expectations were updated
  to the full trail (copy the ticket changes on purpose, not a weakened assertion).
- A5 Programs do not share the grant tab-strip pattern (the program page is a single form), so
  only grants got the "Edit grant" header button. The edit page itself keeps the tab strip with
  nothing highlighted and no button.
- A6 "20 transactions" = new + changed + unchanged transactions in the batch; the changed/deleted
  link condition uses the transactions bucket (changed + deleted), matching what the changes
  page lists. The batch id moved under "Technical details" with the SHA-256 hashes.
  `e2e/import.spec.ts` now asserts the new banner sentence (copy the ticket changes).
- A7 "Unmapped detail" on coverage now lists program-category programs only (M&G/FR have no
  unmapped expense under the one definition) and counts distinct transactions per account
  (Youth Meals · Rent 6210 = $1,800.00 over 3 transactions, per the golden numbers).
- A8 The History tab uses a new `HistoryDiff` (labels, currency, ids → names, "No field changes",
  raw JSON under "Technical details"); the import "changed and deleted" page keeps the raw
  field diff because its rows are QuickBooks transaction fields (Phase D/E territory).
  `e2e/grants-programs.spec.ts` now asserts "Award amount: $10,000.00 → $12,000.00" instead of
  the raw `awardAmountCents 1000000 → 1200000` (copy the ticket changes).
- A9 Delete confirm works without JS: the icon opens a server-rendered confirm banner
  (`?delete=<id>`) whose "Delete line" button posts the delete; no `window.confirm`.
  `deleteBudgetLine` itself was already a hard delete before this ticket (guardrail says
  supersede/soft-delete) — left as is, flagging it.
- A9 "submit cents": the island writes integer cents into a hidden `budgetCents` per row on
  submit; without JS the decimal text posts and the server parses it (`parseMoneyToCents`), so
  the same action serves both. Only rows whose values differ from the stored line are written
  (one audit event per changed line, none for untouched rows). The redirect carries
  `?saved=<n changed rows>`.
- A9 "Total row and chip stay live": besides re-rendering after save, the island updates the
  working total and the "matches award / over|under award by" chip as budgets are typed.
- A10 The `page` (page break) parameter still sections the on-screen report when a URL carries
  it (the "Grant budget line × GL" preset and existing saved views do); the filter bar just no
  longer offers it, and re-applying filters drops it. The PDF export is now a GET form with
  the current parameters as hidden inputs plus the Page break select. `e2e/reports.spec.ts`
  scopes its filter selectors to the filter bar because of those hidden inputs (no assertion
  changed). Errors from "Save current view" still surface on /reports (the action redirects
  there), which is where the saved-views list lives.
- A11 Vocabulary applied via `src/copy/terms.ts`. Beyond the pages the ticket lists, the sweep
  also touched: reconciliation check details ("allocated amounts" instead of "pieces"; these are
  stored per run, so the dashboard/run pages show the new wording after a recompute), the run
  "stats" check (was a raw JSON dump with a `pieces` key — now a labelled sentence), the
  /runs config hash (now under a collapsed "Technical details" per row, Phase D still owns the
  rest of that page), the transaction audit page (/lines/[id]) headings, the "cell" wording on
  the budget/rules/review/activity/effort pages, and nav "Allocation Rules" → "Shared cost
  splits" (nav.spec breadcrumb expectation updated to the new label). Left untouched: internal
  ids/routes/params/testids (`bva`, `partyIds`, `cell-grid`, …) as the guardrail requires.
- A11 "Stale" → "Needs update": the header pill already said "Recompute needed"; the run list,
  run page and tie-out panel pills now say "needs update". `StaleRunBanner` copy already
  avoided the word.
- AC13 test matches the ticket's capitalised terms ("Parties", "Payees", "Revenue matcher",
  "Lines → pieces") as written and the lowercase ones case-insensitively; the imported file name
  `parties.csv` inside the collapsed Technical details is the reason (it is the real file name,
  not copy). The check runs over visible text with tags/scripts stripped.
- A11 "Funder view" card header no longer shows "run <hash>"; when there is no current run it
  says "· no current run" (the header status already states when books/run were updated).
- A11 `tests/db/reimport.test.ts` asserted the check detail string "1 allocation pieces"; the
  expected copy was updated to "1 allocated amounts" (the count and status assertions are
  unchanged — only the vocabulary the ticket renames).
- A11 / verification: two existing e2e specs asserted renamed copy and were updated to the new
  wording only (`e2e/runs.spec.ts` "Source line" → "Transaction (as imported"; the JPH-30 AC5
  crosswalk notice "member lines" → "transactions of its own"). No figure or count changed.
- Verification: the import batch "changes" page overflowed a 390px viewport once a batch with a
  changed transaction existed (the AC8 fixture batch exposed it); its card now scrolls
  horizontally like the other wide tables. The Phase A spec's grants are named "Z Phase A …",
  start after the books-through date, and are removed through the app's delete/archive flow so
  the other Playwright projects (which crawl the alphabetically first grant and assert the
  dashboard's flagged list) are not disturbed.
- Review follow-up (A3): the three "unmapped program expense" figures now share one predicate
  and one period (`src/domain/unmapped.ts`): status `ok` (an allocation conflict or crosswalk
  conflict is a conflict, never a gap), program-category program, no budget line, expense
  account, transaction date inside [fiscal year start, as-of]. The stored reconciliation check
  covers [fiscal year start, books through] and says so in its detail; the dashboard re-derives
  the check row for whatever as-of it shows, so card, check and coverage total agree at any
  as-of (AC4 now also asserts an earlier as-of through the cookie path). The dashboard's
  expense cards and monthly chart read the stated period (fiscal year start – as-of) instead of
  "everything up to as-of"; identical on the demo fixture, differs only for orgs with books
  before the fiscal year start. The coverage "Conflict ($)" column now includes allocation
  conflicts too so every row ties: total = mapped + unmapped + conflict.
- Review follow-up (A9): the single-form save is one database transaction
  (`saveBudgetLines`): a row that fails validation — including a code entered twice in the
  batch, which is now checked up front — rolls back every earlier row and its audit events
  (`tests/db/grants-programs.test.ts` "a batch save commits every edited line or none of them").

## JPH-25 → JPH-26 — Phase B: one rule builder

### Preflight

- typecheck, lint, `pnpm test` (one pre-existing skip: the private-fixture parity test) and the
  full e2e (107 passed, 9 project-gated skips) were green on main before any change. Phase 0
  (`src/domain/grant-figures.ts`, `Grant.trackingMode`) and Phase A (`src/copy/terms.ts`,
  `src/domain/period.ts`, Coverage "Create rule") are present.
- AC1 / AC8 baselines were captured on pre-change main and committed as
  `tests/fixtures/jph26-baseline.json` (list-page sentences for the 6 demo crosswalk rules and
  the 20 pilot grant rules; AllocatedLine totals per budget line and GrantLineResult totals per
  working line). The collector is `tests/db/jph26-baseline.ts`.

### Golden numbers — pilot Dana Fairley discrepancy

- The ticket says "Service Providers AND name Dana Fairley → 1 transaction · 27,500". The pilot
  export (`fixtures/pilot/salah-export.csv`) has **two** Dana Fairley checks under Service
  Providers – Programs: 125.00 on 06/08/2026 and 150.00 on 09/21/2026, total 275.00 =
  **27,500 cents**. Both fall inside the app period for the pilot org (fiscal year start through
  books-through Sep 22, 2026), so the engine and the builder report **2 transactions · $275.00**.
  The total agrees with the ticket; the count does not. AC3/AC6b assert the real engine count and
  the 27,500-cent total; no expected value was edited. If the ticket meant a different Dana
  Fairley line, say which and the assertion follows.
- Practitioners working line 710,000 and Salah needs-review 118,841 are unchanged (AC8 baseline).

### Decisions taken (revisit if wrong)

- B1 two wordings, one grammar. `describeRule` returns the ticket grammar ("… transactions where
  account is A AND name is B → target"); the list pages ask for `wording: 'list'`, which renders
  the pre-phase strings ("Program is Culinary Training AND account is Salaries & Wages or Payroll
  Taxes") byte-for-byte (AC1 asserts this against the captured baseline). Both come from the same
  condition builder, so a new matcher group is described once. The /crosswalk list header
  "Matchers" became "Matches when" (the word is banned by the vocabulary rule; /crosswalk is not
  in the visual baseline).
- B2 one client component, server-rendered. The builder is a single `'use client'` component
  (justified in its header comment) whose fields are all real form controls; the "Add condition"
  menu is a `<details>` that, before hydration, simply contains the remaining rows, and "Rule
  decides" / "Show all accounts" are driven by CSS `:has()`. With JS disabled the form submits
  and previews through the server action's `?preview=1` bounce; the server action, the bounce and
  `POST /api/rules/preview` read the form through one reader (`src/lib/rule-form.ts`), so the
  saved matchers JSON is the same with and without JS (AC2).
- B2 preview is the app period for both kinds. The old grant-rule preview counted every member
  line regardless of date; the ticket asks for "<count> transactions · $total in <period>", so
  the grant preview now filters the engine's decided lines to the app period. The crosswalk
  preview counts allocated amounts (pieces) as before but the panel says "transactions" per the
  vocabulary rule; on the demo fixture the two coincide (3 · $1,800.00 for Youth Meals / Rent).
- B2 name auto-fill uses the sentence with the "(choose a target)" placeholder dropped while no
  target is chosen, truncated to 80 characters with an ellipsis. The server applies the same
  suggestion when the name arrives blank, so a no-JS save never fails on a missing name.
- B4 superset warning semantics: the JPH-9 conflict check is a runtime tie detector, so
  "matches everything rule X matches; it will never win" is computed as: run the engine with the
  candidate at priority (stored − 1) and again at its stored priority; if the candidate wins at
  least one allocation at the lower number but none at its own, every line it matches is already
  won by a lower-numbered rule, and the warning names the rule that takes the largest share.
  Ties at equal priority are left to the conflict banner as before.
- B4 default priority 50 is applied only when the field arrives blank or absent; stored rules
  re-render with their own value and the edit form never rewrites it (AC4).
- B5 prefill ignores ids the org does not have rather than rendering a phantom condition; a
  `/new` URL with only unknown ids is a blank form.
- Program row on crosswalk rules is offered through "Add condition" (the ticket's two starting
  rows are Account and Name); `e2e/crosswalk.spec.ts` was updated to open it. Any prefilled
  group opens as a row automatically.
- AC3 sentence uses the stored names. The ticket abbreviates "Salah transactions where account is
  Service Providers …"; the pilot grant is named "Salah Foundation — Trauma Programs" and the
  account "Service Providers - Programs", so the builder (and the test) render
  "Salah Foundation — Trauma Programs transactions where account is Service Providers - Programs
  AND name is Dana Fairley → Dana Fairley". No alias table was added; say so if the sentence
  should use a short grant name.
- Scope-item commits: B2 lands the builder with the island's fetch and the superset/prefill
  modules it imports (they must compile together); B3 adds the route handler, B4/B5 add their
  tests and notes. Feature code therefore sits one commit earlier than its label in two cases.
- Stored matcher shape: the builder omits groups the user left empty (the old crosswalk form
  wrote `classIds: []`, `descriptionContains: ""`, … for every group). The schema already treats
  absent and empty alike, so nothing in the engine changes (AC8 equality holds); the reason is
  AC4 — a seed rule opened and saved untouched must come back with exactly its stored keys.
- Flake seen once in the full e2e (not reproducible alone): `reports.spec` "GET builder …" read a
  grand total of 7,651,860 instead of 7,711,861 — the 600.01 March utilities line, which
  `allocation.spec` edits (split rule) while `status.spec`/`runs.spec` recompute in the same
  parallel project. Pre-existing cross-spec race; the rerun was green (124 passed). Not touched.

## JPH-26 → JPH-27 — Phase C: review queue

### Preflight

- typecheck, lint, `pnpm test` (one pre-existing skip: the optional live-model narrative smoke
  test) and the full e2e were green on main before any change. Phase B is present
  (`src/domain/describe-rule.ts`, shared `<RuleBuilder>` with query-param prefill in
  `src/components/rule-builder/prefill.ts`).

### Golden numbers — what the pilot fixture actually contains

- Salah has **eight** pre-September "Leah" payroll lines under Salaries, not seven: 112.89,
  113.96, 223.74, 232.54, 177.43, 171.60, 167.55 and 102.66. The 113.96 line ("Leah Sanctuary
  Retreat", 03/26) is the positive half of the ±113.96 reversal-pair proposal with JE 19-35, so
  the queue shows it as the pair row, and the seven remaining lines total exactly 118,841 cents.
  The ticket's "7 Leah lines + 1 pair row = 8 rows · $1,188.41" therefore holds only because a
  line inside a proposed pair is a pair row and nothing else. Consequences that follow from that
  reading (revisit if it is wrong):
  - The header total excludes pair rows (they net to zero), so it is 118,841 while the row count
    is 8.
  - Bulk actions ("Select all suggested → …", "Accept N", "Not grant-funded N") take their rows
    from the same queue the page renders, so a pair line is never swept into an accept or
    exclusion even though it also carries the Leah near-miss suggestion. The first cut derived the
    selection from the raw waiting lines and produced `accepted=8`; fixed before commit C4.
  - The sidebar badge and the grant-header chip count transactions a reviewer still has to decide
    on: waiting lines minus the lines a proposed pair already accounts for
    (`toReviewCount` in `src/domain/grant-figures.ts`) — Salah 7, matching the ticket's "badge =
    7" while the queue lists 8 rows. The raw `needsReviewCount` (9 for Salah) is unchanged for the
    JPH-21/23 tests; `NeedsReview.pairedCount` is additive.
- Opioid has a pending ±207.02 proposal of its own (one waiting line, one settled). It is a pair
  row on `/review`, not a transaction row, and it counts 0 toward the badge, so "nothing for
  Opioid" (AC10) is asserted as *no Opioid transaction row and no Opioid group*; the pair row is
  allowed. If a pending pair on Opioid should also be hidden from `/review`, say so and the
  filter follows.

### Decisions taken (revisit if wrong)

- Suggestion reason uses the stored rule name. The pilot rule is named "Leah payroll from
  September", so the reason reads `Matches rule "Leah payroll from September" except the date`;
  the ticket's `Matches rule "Leah"` was read as an abbreviation, not as a rename of the rule
  (renaming it would alter the JPH-21 fixture). AC2 asserts the full string.
- "Leah" is a description term, not a name. The ADP payroll lines carry the payroll provider (or
  nothing) in the QuickBooks Name column and "Leah …" in the description, and the pilot rule
  matches on `descriptionContains`. "Always do this" from a Leah row therefore prefills the row's
  name (when it has one), Account = Salaries, **description contains "Leah"** (the near-miss
  rule's description term, so the proposed rule is the pilot rule minus the date) and
  Target = Leah (Sept+), plus `returnTo` so saving lands back on the queue. AC7 asserts that; the
  literal "Name = Leah" in the ticket cannot be met because no party is called Leah.
- Near-miss ranking: among rules that miss on exactly one condition, the one with the most
  satisfied conditions wins, then priority. A rule that misses on two conditions is not a near
  miss. Inactive rules and rules whose target left the grant are skipped. Name history counts
  only decisions in the current run on this grant; account default requires exactly one target
  across the grant's active rules that name the account.
- Sort order is "suggested, grouped by target in budget order → unsuggested → pairs", rows by
  date inside each group; the group header carries the select-all checkbox and the count.
- Accept is hidden without a suggestion (ticket); Change is always available and renders a
  working-line select for membership grants and activity + category selects for activity ×
  category grants. Not grant-funded keeps the existing "Draft correcting entry" checkbox (checked
  by default, disabled with the existing Settings hint when no default destination is set) and
  the reason select (not allowable / posted in error / duplicate / other); the note is optional
  and defaults to `Not grant-funded: <reason>` so `LineDecision.note` stays non-empty.
- Bulk exclude of one grant drafts one correcting entry per decision group (shared `groupId`) and
  redirects with `excluded=N&drafted=<code>`; when the destination is unset it redirects with
  `excluded=N&blocked=1` — the exclusions are kept, only the draft is skipped (same as the
  single-row path).
- After any action the page redirects to itself; `revalidatePath('/', 'layout')` is called so the
  app header's Recompute button and the sidebar badge re-render on the same URL. Recording a
  decision marks the run stale (existing behaviour); Status/Funder figures follow the current run
  until Recompute, so the AC4/AC5 golden numbers are asserted after the header's Recompute.
- `/review` is one table across membership-tracked grants (archived grants excluded) with a Grant
  column; crosswalk-tracked grants keep the Phase 0 explanatory notice on their own review page
  and do not appear on `/review` at all (they have no queue). Say so if a "tracked by crosswalk"
  line per grant is wanted there.
- Vocabulary: "member lines" → transactions, "kept by import fingerprint" → gone, "cell" →
  "activity × category" via `src/copy/terms.ts`. AC13 scans the rendered text of both pages for
  `member line`, `fingerprint` and `\bcells?\b`; "spreadsheet cell" does not occur.
- Keyboard island: `J`/`K` move a focus ring between rows, `A` submits that row's Accept, `C`
  opens its Change form, `X` opens its Not grant-funded form; the legend is one line above the
  table and the island announces readiness with `data-island="ready"` so tests never race
  hydration. Without JS every action is a plain `<form>` POST (AC8 runs with
  `javaScriptEnabled: false`).
- Playwright: the Phase C suite is its own project (`phase-c`, JS on, depends on `pilot`, single
  worker); the full run on this 8 GB container needs `--workers=1` — with two workers the dev
  server (2–3 GB) plus the workers and the editor's TypeScript server exhausted memory and the
  dev server was killed mid-run.
- Review follow-ups (after the first completion review):
  - A ticked group header ("Select all suggested → Leah (Sept+) (4)") posts the ids of the rows it
    listed when rendered — filters included — and the server accepts only those that are still
    waiting and still suggested to that target. The first cut expanded the header to every
    waiting transaction with that target, so a date-filtered "(4)" could accept all seven.
    Covered by the "Filtered bulk" e2e (JS and no-JS paths).
  - The sidebar badge, the grant-header chip and the figures' "waiting" amount now overlay the
    decisions recorded since the current run, exactly as the queue does (`reviewQueue`), so they
    drop on the same round trip as the row instead of waiting for Recompute. The run stays the
    truth for assigned/excluded spend until Recompute, as before. `needs_review` results that
    carry a decision id (an assignment whose target left the grant) are no longer skipped by the
    badge. AC3 asserts badge 6 / chip 6 before the recompute.

### Not done / left as is

- The JPH-26 Dana Fairley count question is untouched.
- No D1 decision is seeded; the seven Leah lines stay in the queue.
- Screenshots of `/grants/<salah>/review` before and after are under
  `artifacts/screenshots/jph27/` (gitignored, not committed).

## JPH-27 → JPH-28 — Phase D: close checklist, automatic recalculation, activity log

### Preflight

- `typecheck`, `lint`, `test` (306 unit tests) and `e2e` (138 passed / 13 skipped, `--workers=1`)
  were green on the Phase C branch before D1; `/review` and `src/domain/suggest.ts` present.

### Decisions taken (revisit if wrong)

- **Which writes trigger the automatic calculation.** Every server action whose service marks
  the current run stale now calls `recalculateAfter(orgId, cause)` before it redirects:
  crosswalk rules, shared cost splits (allocation rules), programs, grants (create / edit /
  archive / delete), budget lines (single, bulk, import, activities), grant rules, review
  decisions (single, bulk, revert, pair, flag), effort schedules and counts, and both imports
  (`trigger = import`). Carrying a variance and voiding a draft do not touch the run and were
  left alone; the checklist reads them directly. Reported periods, period locks, narratives and
  settings never marked the run stale, so nothing was added there.
- **Concurrency** is a per-org `RecomputeLock` row (`running`, `pending`) taken inside a short
  transaction. A second mutation while a calculation is running sets `pending` and returns
  immediately (`kind: 'coalesced'`); the running one loops once more when it finishes. Two
  mutations within 100 ms therefore produce at most two runs and never two concurrent ones
  (`tests/db/recompute-queue.test.ts`). The CLI `pnpm recompute` still calls the engine directly
  (no lock) — it is a developer tool, not a user path.
- **AC2 in the browser is proven with a recorded failed calculation, not a live invariant
  breach.** Forcing a real invariant failure through the UI on the demo fixture would need a
  corrupt write the app refuses to make. The failure path itself (invariant violation → failed
  row recorded, previous run stays current, `kind: 'ran'` with `status: 'failed'`) is a unit
  test; the e2e inserts a failed `ComputeRun` newer than the current one (exactly what that path
  records) and asserts the chip, the red blocker on `/` linking to `/runs/<id>` and the activity
  row. If a fixture that breaks an invariant on demand is wanted, say which one.
- **Step rules that the ticket table left open.**
  - Step 1 "latest import date" is the batch's `finishedAt` (falling back to `startedAt`), not the
    export's date range; "12 days ago" counts from now, greenness from the as-of.
  - Step 2 green when the needs-review **total is 0** (the ticket's rule), so a queue holding
    only reversal pairs (±113.96 netting to zero) is green with the pairs mentioned. "Review N"
    counts the rows of grants whose waiting total is **not** zero: on the pilot fixture `/review`
    lists 9 rows (Salah's 7 Leah lines + 1 pair, plus one Opioid pair on May 20, 2026 that nets
    to zero), and the ticket's "Review 8" is only reachable if a grant that already nets to zero
    is treated as settled for this step — which is what the green rule says anyway. If "Review 9"
    (every row) is what you wanted, it is a one-line change in `src/services/close-status.ts`.
  - Step 3 amber when any grant is flagged **or** any health check warns; **red** (a blocker, and
    the period cannot be called closed) when a check on the current calculation is recorded as
    `fail` / `ok: false` — a successful calculation can still carry a failed trial-balance or
    overlapping-rules check. The `stats` pseudo-check never counts. The demo fixture opens on
    step 3 (2 flagged, 2 warnings), which is where the old cards now sit.
  - "Closed through …" is never shown while the newest calculation attempt failed, even with
    seven green steps: the steps were judged on the previous calculation's numbers.
  - Step 4 "variance is 0 or carried": carried means `carriedVarianceCents === varianceCents`
    on an active schedule of a non-archived grant; the badge sums `|variance|` over the open
    schedules. The button goes to the first open schedule's grant.
  - Step 5 counts `CorrectingEntryDraft` rows in `drafted` status; the amount is Σ debits.
  - Step 6: the rollforward XLSX route writes an `Export` row (`kind = rollforward_xlsx`,
    period = the exported `from`/`to`); the step is green when an export's period **contains the
    as-of**. Exporting a different period does not count (asserted). The PDF/CSV rollforward
    routes, if any, do not record exports — only the XLSX the ticket names.
  - Step 7: green when a `PeriodLock` whose range contains the as-of exists; the button goes to
    `/settings/periods` (the ticket says `/settings`; the lock form lives one level down). The
    form's button was renamed "Lock current run" → "Lock period".
- **The failed-calculation blocker** on `/` shows when the newest failed run is newer than the
  current run's start — i.e. the last attempt failed. Once a later calculation succeeds it goes
  away on its own.
- **Header chip** is server-rendered (no island): "Updated just now" (< 60 s), "Updated N min
  ago", "Updated N h ago", then "Updated <date>"; "Updating…" while the lock is held; "Update
  failed — see activity log" when the last attempt failed; "Needs update · last updated …" when
  the current run is flagged stale (a path that only the CLI or a direct DB write can still
  reach, since actions recalculate). The relative age is computed at render time, so a page left
  open says "just now" until it is reloaded — the ticket asked for no poller.
- **Health-check names.** The six binding names are in `CHECK_LABELS`; two checks the ticket
  did not name were given names in the same voice: `grant_line_states` → "Grant decisions match
  transactions", `stats` → "Calculation statistics" (it is not a check; the activity log and the
  checklist skip it). Rename if you prefer others.
- **Vocabulary elsewhere.** `/runs` and `/runs/[id]` keep their tables but say "Calculation" /
  "Calculations", show trigger and cause, and no longer carry a Recompute button; the sidebar
  item "Activity log" is highlighted for `/runs*` and `/import*`, and the trail reads
  "Data › Activity log › Calculations › Calculation <date>". `/runs?done=` redirects now land on
  `/activity?done=`.
- **Old dashboard cards** are rendered by `src/components/overview-cards.tsx` from
  `src/services/dashboard.ts` (extracted from the old page verbatim) on `/reports/overview`;
  step 3's detail reuses three of them (restricted balances, flagged grants, health checks) and
  links to the full overview. Existing specs that read the cards on `/` were pointed at
  `/reports/overview` — the assertions and golden numbers are unchanged.
- **Timing.** Auto-recalculation on the pilot fixture is measured in
  `e2e/jph28-phase-d-pilot.spec.ts` (bulk accept → redirect, which includes the calculation) and
  logged as `[JPH-28] bulk accept + auto calculation … ms`: 1,030–1,219 ms on this workspace,
  inside the ≤ 2 s target.

### Not done / left as is

- `pnpm recompute` (CLI) and the seed scripts bypass the lock; they record `trigger = manual`
  with no cause.
- No JPH-29 work; QuickBooks stays read-only; the engine is untouched.
- Screenshots of `/` before and after are under `artifacts/screenshots/jph28/` (gitignored).

## G1 — GitHub main as source of truth, template cleanup, CLAUDE.md

### Decisions taken (revisit if wrong)

1. **JPH-25..29 were committed, not uncommitted.** Local `main` carried seven commits past the
   GitHub head d177232 (JPH-25, 26, 27, 28, 29, the post-merge migration script and a "Published
   your App" checkpoint). The local and GitHub histories share no ancestor — every push from the
   workspace replays the tree through the GitHub API, so commit ids never match. They were pushed
   as one replay commit `JPH-25..29: sync deployed UX phases to git`; the per-phase history stays
   in the workspace's local `main`. `git diff HEAD origin/main` is the check that matters and it
   was empty (apart from item 2) after each push.
2. **`.github/workflows/ci.yml` is not on GitHub.** The GitHub connection available from the
   workspace lacks the `workflow` OAuth scope; a tree containing that path is rejected. The file
   is committed locally and must be pushed from a machine with a normal git remote (it is the
   only difference between local `main` and `origin/main`).
3. **`vite` became a direct devDependency of `@workspace/app`.** Vitest peer-depends on it and
   it had only resolved through the removed `mockup-sandbox` package (`autoInstallPeers: false`).
   Lockfile change only; no test or app behavior changed.
4. **`pnpm run test -- src/privacy` runs the whole suite.** pnpm forwards the literal `--` and
   vitest ignores the filter, so the first "privacy scan" of this task ran all 57 files and
   truncated the dev database (it now holds the last test org, not the demo overlay). It was
   not restored because `seed:demo` was off-limits; restore with the recipe in CLAUDE.md before
   using the preview or running e2e. CLAUDE.md documents `pnpm exec vitest run src/privacy`.
5. **`artifacts/app/AGENTS.md` is a pointer plus the Next.js block.** `next dev` re-appends its
   `nextjs-agent-rules` block on every start (`generate-agent-files.js`), so a strict one-line
   file would be dirty after the first run. `artifacts/app/CLAUDE.md` is one line.
6. **`.replit-artifact/` is now git-ignored and `artifacts/app/.replit-artifact/artifact.toml`
   was untracked** (file kept on disk). Consequence: importing the GitHub repo into a fresh
   Replit workspace will not recreate the `artifacts/app: web` service registration; it has to
   be re-registered there. `.replit` itself stays tracked. `.replit` had no per-workflow entries
   to remove — the removed workflows were derived from the deleted artifacts' `artifact.toml`.
7. **`src/services/funder-view.ts` does not exist.** `replit.md` cited it for the JPH-23 funder
   view; the funder/internal tables read `src/services/bva.ts` and `src/services/grant-budget.ts`
   through `src/app/grants/[id]/bva/`. CLAUDE.md and replit.md were corrected.
8. **`replit.md` was trimmed in the CLAUDE.md commit** (removed-package commands, template
   stack section) rather than left describing packages that no longer exist.
9. **`attached_assets/` (the pasted task text) is untracked and not ignored.** Left alone.
