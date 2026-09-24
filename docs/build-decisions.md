# Build decisions (from chat with Ben, 2026-09-23)

- Source of truth: Jira epic JPH-3 (gravitasiq.atlassian.net), cloudId 5fe4b259-a659-4a52-adda-a4d488c3f702. Full text in docs/jira-epic-JPH-3-spec.txt.
- Do stories JPH-4..JPH-13 and JPH-15. SKIP JPH-14 (live QBO connector).
- JPH-15: build CSV side fully; QBO-specific parts (CDC sync, TrialBalance report pull) are clearly-marked stubs behind the DataSource interface; note this in the Jira ticket.
- GitHub: bensommer/grant-allocation-tool (private).
- Jira: transition each story To Do -> In Progress -> Done and comment with the PR/commit link.
- Anthropic: Ben has ANTHROPIC_API_KEY; request it as a project secret when JPH-13 starts. NARRATIVE_MODEL from env.
- Styling: Tailwind (document in README). Rounding: integer cents, largest remainder, ties to lowest target sort order.
- Developer uses tcsh: README snippets must be tcsh-compatible or npm scripts.
- Golden suite (fixtures/demo/expected.json) is the gate for stories 07/08/09.

## Post-review hardening (JPH-8..10)

- Recompute is serialized per org with `pg_advisory_xact_lock` for the whole pipeline; if the config
  hash differs at promotion time the new run is promoted but flagged stale immediately. A partial
  unique index (one current run per org) was considered and dropped because Prisma cannot express it
  and `migrate dev` would generate a migration removing it.
- Rule previews run the real engine over the date range with the candidate rule inserted (or
  replacing the rule being edited) and count the pieces it actually wins, so the preview total equals
  the rule's contribution after recompute. `contested` counts pieces lost to a priority tie.
- Every id submitted from a form (programs, accounts, classes, locations, parties, grants, budget
  lines) is checked against the org in the service layer (`src/services/refs.ts`).
- Known limitation: a changed re-import updates source lines in place and marks the current run
  stale; historical runs are not snapshotted, so `/runs/[id]/diff` against a pre-import run reflects
  the new source amounts.

## JPH-13 narratives

- Model client is injected (`NarrativeModel`); `narrativeModel()` returns null without
  `ANTHROPIC_API_KEY`/`NARRATIVE_MODEL` and the pages explain why generation is disabled.
  `NARRATIVE_FAKE_MODEL=1` (non-production only) returns a canned draft for local/e2e use.
- Real model output arrives fenced (```json); the client strips fences and takes the outermost object
  before the zod gate. Verified live: a Q1 G-MWSC draft cited 45 figures, all verified.
- Grounding packet separates period figures (rows, actuals for `[from,to]`) from inception-to-date
  figures (received, restricted balance, pacing as of `to`); derived keys are `period.*` / `itd.*` and
  include per-line per-account/per-vendor sums so natural sub-totals verify.
- `($5,000.00)` is negative only when the paren closes right after the amount; `($5,000.00 monthly)`
  is prose. Malformed precision (`$1,234.567`) is extracted and stays unverified (fail closed).

## JPH-16 UI overhaul

- PDF rendering uses pure-JS pdfkit with built-in fonts and data-driven tables/documents.
  The deployment host has no Chromium; this avoids a headless browser and external
  service dependency while producing deterministic output from the same report data.

## JPH-15 re-import and reconciliation

- Change detection hashes normalized rows; missing rows are soft-deleted only on full-range imports.
  `TransactionLine.deletedAt` was added so a re-imported transaction with fewer lines keeps old
  `AllocatedLine` references intact; new runs exclude soft-deleted lines.
- New transactions dated inside a locked period flag the lock too (`counts.lockNewIds`).
- Reconciliation checks count exactly what the engine counts (unassigned = all pieces without a
  program, including income); trial-balance tie-out warns on partial account coverage.
- QBO CDC/TrialBalance pulls are `NotImplemented` stubs behind `DataSource` (JPH-14 skipped).

## JPH-16 UI overhaul (continued)

- Presentation-only except two dashboard changes: the "unmapped" card counts program-service expense
  only (M&G/Fundraising is shown as expected non-grant expense), and as-of defaults to the last
  imported transaction date. Report pivot keys are unchanged (`number name` for accounts, codes for
  grants/lines/programs); display names travel in `labels`/`secondary` metadata so the golden tests
  still address cells by key.
- Inter is self-hosted from a local woff2 (`next/font/local`) so production builds never fetch
  Google Fonts.
- Visual baselines are captured against pristine demo data; CI runs `visual.spec.ts` right after
  seeding and before the specs that create records.
- Allocation editor "Change method" / "Add target" are GET submits of the whole form, so no-JS users
  keep their input; the client island only adds instant feedback.
- Report budget columns come from `GrantBudgetLine` (not allocated facts) and are offered only when
  rows are budget lines and the page break is by grant or none.
