# Questions and decisions taken while implementing

Ambiguities met during a ticket are recorded here with the decision taken, so nothing is guessed
silently. Each entry names the ticket, what was unclear, what was done, and what would change if
the answer is different.

## JPH-28 → JPH-29 — Phase E

1. **To do badge vs. "Review · 8".** The ticket's AC6 wants "Review · 8" first (Salah's queue
   holds 7 Leah rows and one pair that nets to zero), while the To do badge "shows open count".
   Decision: the section heading counts the queue (8, as the review page does); the badge and
   the header line count decisions to make (7 — pairs need none), and pairs never block
   "Nothing to do". If the badge should read 8, drop `pairCount` from `openReview` in
   `src/app/grants/[id]/todo/page.tsx`.
2. **"What's next" on a grant's To do.** The close checklist is org-wide; per grant it is run on
   the grant's own input (`grantCloseInput`), so org-wide health warnings disappear and the
   budgets step can say "1 flagged grant: <this grant>" on the grant's own page. Left as the
   checklist wording rather than inventing a second vocabulary.
3. **Setup is a route group, not one page.** Setup = `(setup)` route group around the existing
   `/edit`, `/budget`, `/rules`, `/activity`, `/periods`, `/history`, `/narratives` pages with
   a shared rail; the tab links to `/edit`. `/grants/[id]/setup?section=` only redirects (the
   mobile select needs a GET target that works without JavaScript).
4. **"Activities" in the Setup rail** points to `/activity` (the grid page, which links to
   `/budget#activities` for editing) so every old route is reachable from a tab in two clicks
   (AC1). Activities are still edited on the budget page.
5. **Funder view has no nesting.** "Funder categories only, funder totals" was read literally:
   the funder view shows the four category rows and the funder totals row, nothing under them;
   the internal view nests lines under categories and its totals row is the funder total (lines
   roll up). The 61-cent working-vs-funder difference is surfaced by the Setup dot and on
   `/budget`, not in the Budget vs. Actuals totals row.
6. **"Neither — I import a QuickBooks report per grant"** clears `memberClassIds` /
   `memberPartyIds` (Phase 0's `trackingMode` then derives from the import scope or the
   crosswalk, as before); the Override disclosure still records
   the QuickBooks class / project _names_ (needed for correcting entries, JPH-22). Salah on the
   pilot fixture has no "Trauma Grants" class in its imported books, so the block offers the
   recorded name as a pseudo option ("Trauma Grants (not a class in the imported books)") and
   the live count says the grant's transactions come from its report import.
7. **Live count** counts transaction lines (not headers) carrying the class / customer, across
   the whole books, excluding deleted lines. "1,204 transactions" in the ticket was read as
   lines because that is what the app calls transactions everywhere else.
8. **Wizard budget paste** accepts two columns (name, amount) or three (code, name, amount); a
   code is optional and generated from the name when absent. `seed:pilot` matches lines by
   code, so AC9 pastes the codes from `fixtures/pilot/seed.json`.
9. **AC9 — "the wizard reproduces seed:pilot for Salah".** The pilot export carries no class
   column, so the wizard cannot pick "Trauma Grants" as a class; the test chooses "Neither",
   records the class name behind Override, enters the award, categories and lines, finishes,
   then runs `seed:pilot`, which finds the grant by name and adds only what a wizard cannot
   (the report import, the eight rules, the 1,400 revision). Asserted: the grant rows the
   wizard wrote equal the seed's, and the Status / Budget vs. Actuals figures afterwards are
   the seeded golden figures with 7 transactions in review (the pre-D1-A state, since "7 in
   review" is before D1-A).
10. **Step 5 pre-selection never fires for a brand-new grant.** Phase C's engine returns
    confidence `account` only when an existing rule already covers the account; a grant created
    by the wizard has no rules yet, so every proposed row starts at "Decide later" (AC13 asserts
    exactly that). Pre-selection becomes visible when the wizard is used to re-set-up a grant
    that already has rules.
11. **Step 5 excludes income accounts** (only Expense / COGS / Other Expense accounts are
    proposed); income is matched through the Grant income block, not through rules.
12. **Step 4 lines need not add up to the category** (the 61-cent case is real); the chip
    warns, Continue is allowed.
13. **JPH-27 / JPH-8 e2e re-pointed** from `/grants/new` to `/grants/new?mode=form`, as AC11
    requires; no assertion changed.
14. **`postedExport` helper** (Phase D's posted-journal export builder) moved from the Phase D
    spec into `e2e/pilot-posted-export.ts` so the Phase E spec can reuse it; the Phase D spec
    imports it unchanged.
15. **"Pacing/forecast strip" on Status.** The header's "Spent vs. budget" card already carries
    the pacing callout (JPH-30's pace string, asserted once per page by its tests), so the strip
    below Budget vs. Actuals is the _forecast_ half only — remaining, months left, needed per
    month and the straight-line projection — instead of a second copy of the pace callout.
16. **Grant income on step 2 (review fix).** The block's selections now reach the grant. Until
    the step is posted, the funder's own customer (from step 1) is the default receipts
    source; once posted, whatever was left checked stands — including nothing, marked by a
    hidden `incomePosted` field because an empty multi-select posts no values.
17. **Finish is one transaction (review fix).** Grant, categories, lines, rules and the draft
    deletion commit together; the inputs are checked against the persisted schemas first and a
    problem is reported on the step that owns it. Steps 3 / 4 also apply the budget line code
    rule (letters, numbers, dash, dot, underscore; 30 characters) so Finish cannot fail on a
    code the step accepted.
18. **Funder view exports (review fix).** CSV, PDF and XLSX of the funder view now carry the
    category rows only, exactly as the page shows them; `/funder/pdf` (old route) does the same.
    `funderViewTable` (the nested JPH-23 table) is kept for its unit tests and as the basis.
19. **Grants tracked by a class and a customer (review fix).** The block shows one radio, so
    the list it does not show (member customers under Class, member classes under
    Project / customer) is carried through as hidden fields and named in an "Also tracked by
    …" line; saving the form unchanged keeps both lists and their memberships. Only Neither
    clears them, as item 6 already says.
