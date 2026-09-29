# Grant Allocation Tool — agent guardrails

Server-rendered Next.js app for nonprofit finance teams (CPAs): grant × program × GL allocation,
crosswalk of QuickBooks-shaped ledger data to grant budget lines, shared-cost allocation rules,
Budget vs. Actuals, restricted-fund balances, month-end close checklist, review queue, AI-drafted
funder narratives. pnpm monorepo; the whole product is the one package `artifacts/app`
(`@workspace/app`). `scripts/` holds only `post-merge.sh` (Replit post-merge hook).

Source of truth is GitHub `bensommer/grant-allocation-tool` `main`. Never `git push --mirror`
or force-push: Replit's internal checkpoint refs may still reference a squashed commit that
contained real client names (QUESTIONS.md, JPH-20 follow-ups).

Spec: `docs/jira-epic-JPH-3-spec.txt` (repo root). Build decisions: `docs/build-decisions.md`.
Data model: `docs/data-model.md`. Definitions and sign conventions: `artifacts/app/docs/definitions.md`.
Decisions and open questions per ticket: `QUESTIONS.md` (root; the app-level
`artifacts/app/QUESTIONS.md` holds the JPH-29 entries).

## How to run

- Replit: workflow `artifacts/app: web` runs `pnpm --filter @workspace/app run dev`; Next reads
  `$PORT` (23863 on Replit, `3000` locally per `.env.example`). Do not run `pnpm dev` at the root.
- `DATABASE_URL` (Postgres) is required. `ANTHROPIC_API_KEY` + `NARRATIVE_MODEL` are only needed
  for real narrative drafts; without the key existing drafts stay readable and generation is
  disabled. `NARRATIVE_FAKE_MODEL=1` (non-production only) selects a canned model for e2e.
- Local Postgres: `cd artifacts/app && docker compose up -d` (`docker-compose.yml`, postgres:16 on
  :5432, db `grant_alloc`), then `cp .env.example .env`, `pnpm install`, `pnpm run db:migrate`,
  `pnpm run dev`. `.env` is loaded by Prisma (`prisma.config.ts`) and by Next. On Replit
  `DATABASE_URL` and `PORT` are injected; no `.env`.
- Env vars are read at first use through `src/env.ts` (zod). A newly added env var or a Prisma
  schema change needs a dev-server restart (stale Prisma client → 500s).

### Commands (run from `artifacts/app` unless noted)

| Command | What it does |
| --- | --- |
| `pnpm run typecheck` (root) | typecheck every package (`artifacts/**`, `scripts`) |
| `pnpm run typecheck` | `prisma generate` + `tsc --noEmit` (strict) |
| `pnpm run lint` | ESLint 9 (next/core-web-vitals + typescript) |
| `pnpm run test` | Vitest unit + domain + DB tests (golden dataset included) |
| `pnpm exec vitest run src/privacy` | the no-private-data scan — run before every push |
| `pnpm run e2e` | Playwright, all projects in dependency order |
| `pnpm run db:migrate` / `pnpm run db:migrate:dev` | `prisma migrate deploy` / `prisma migrate dev` (creates a migration) |
| `pnpm run recompute` | run the allocation pipeline once (same as "Recalculate now") |
| `pnpm run import:csv -- --dir fixtures/demo` | import a CSV bundle (`--from`/`--to` for a partial range) |
| `pnpm run seed:pilot` | seed the two pseudonymized pilot grants (Salah / Opioid) |
| `pnpm run seed:demo` | demo overlay (programs, grants, budget lines, rules) — do not run against real data |
| `pnpm run import:qbo-report -- --file <export> --grant <id or name>` | import a QuickBooks "Transaction Detail by Account" export for one grant |
| `pnpm run fixtures:anonymize -- --workbook <xlsx> --tab "Sheet=out.csv"` | rebuild `fixtures/pilot` from the private workbook |
| `pnpm run parity:report` | parity report from `fixtures/private/parity-map.json` (private only) |

- `pnpm run test` truncates every table in `DATABASE_URL` and leaves the last test org behind;
  set `TEST_DATABASE_URL` to use a separate database. To restore the preview afterwards: truncate
  (same table list as `tests/db/helpers.ts` `resetDatabase`), then
  `pnpm run import:csv -- --dir fixtures/demo && pnpm run seed:demo && pnpm run recompute`.
- pnpm forwards a literal `--` to the script: `pnpm run test -- src/privacy` runs the whole suite
  and `pnpm run e2e -- --project visual` filters nothing. Use `pnpm exec vitest run <path>` and
  `npx playwright test --project <name>` (same env vars) instead.
- Playwright projects, in dependency order: `visual` (baselines against freshly restored demo
  data, runs first and alone) → `chromium` and `chromium-nojs` (functional; `chromium-nojs` runs
  with JavaScript disabled) → `qbo-report` → `qbo-report-nojs` → `pilot` → `phase-c` → `phase-d`
  → `phase-e` (the pilot-fixture projects seed and remove the pilot grants themselves).
  `--no-deps` runs one project alone. Set `E2E_BASE_URL` to test a running server; otherwise the
  config starts `pnpm run dev` on `$PORT`. Use `--workers=1` (two workers OOM the 8 GB dev
  server). On Replit: `E2E_BASE_URL=http://localhost:23863
  PLAYWRIGHT_CHROMIUM_PATH=/repl/tools/bin/chromium pnpm --filter @workspace/app run e2e`
  (the downloaded Chromium lacks system libs). Snapshot names embed the project name.
- LibreOffice (`soffice`) is required by the JPH-23 AC4 test in
  `tests/db/jph23-rollforward.test.ts` (rollforward XLSX formulas); the test forces
  `OOXMLRecalcMode=0` in a throwaway profile, otherwise LibreOffice returns exceljs cached values.
- `.next` cache gotcha: if the dev server crashes with heap OOM or routes take minutes to compile,
  the Turbopack cache in `artifacts/app/.next` has grown past ~2 GB — delete it and restart.
- Prisma client is generated to `artifacts/app/src/generated/prisma` (git-ignored); `typecheck`
  and `build` run `prisma generate` first.
- eslint must stay on v9 (eslint-config-next plugins break on v10). Keep `prisma` and
  `@prisma/client` both on ^7 (`pnpm add -D prisma` resolves to an 8 release candidate). pnpm's
  `minimumReleaseAge: 1440` blocks packages published in the last 24 h.
- `seed:pilot` reuses existing grants by name, so decisions/locks left by an aborted e2e run
  persist into the next one; `e2e/pilot.spec.ts` afterAll removes them. If pilot tests fail on
  line counts, delete the Salah/Opioid grants and post-seed `PeriodLock` rows and rerun.
- Playwright specs run in plain Node: nothing they import from `src/` may reach `next/navigation`.
- `next dev` re-adds its managed block to `artifacts/app/AGENTS.md` on every start; commit it
  rather than fighting it.

## Architecture rules

- Next.js App Router + Prisma 7 (pg adapter), NOT the template's Vite/Express/Drizzle/Orval
  stack — the Jira spec mandates server-rendered pages, server actions, forms that work without
  JS, no SPA. Every screen is its own route under `src/app`; pages are React Server Components
  that read from Postgres via Prisma; mutations are server actions invoked from native
  `<form action={...}>` elements, so every workflow functions with JavaScript disabled (the
  `chromium-nojs` project enforces this). No React Query, Zustand, client-side global store or
  client fetching for page data. Client components are leaf islands only, each with a comment
  justifying why it needs the browser.
- Money = integer cents (Int32) everywhere (`src/domain/money.ts`); percentages = basis points;
  splits use largest-remainder rounding with ties broken by lowest target `sortOrder`, so every
  split sums exactly to its source line (`src/domain/split.ts`). Totals stay in cents until export.
- Two data layers (`prisma/schema.prisma`): a read-only source mirror of QuickBooks-shaped data
  (accounts, classes, locations, parties, transactions, lines) that only `DataSource` adapters
  write through the import service, and a user-owned overlay (programs, grants, budget lines,
  crosswalk rules, allocation rules) plus materialized compute output (`ComputeRun`,
  `AllocatedLine`). Source ledger tables are never mutated by the app; changed and deleted source
  rows keep history (`SourceRowVersion`, soft `deletedAt`).
- Single org today; every table still carries `orgId` and reads go through `src/lib/org.ts`.
- QuickBooks is read-only: the app never writes to QBO. JPH-14 (live QBO connector) is skipped;
  QBO pieces are stubs behind the `DataSource` interface (`src/datasource/types.ts`,
  `src/datasource/qbo/adapter.ts`). Correcting entries are exported as Intuit JE CSV drafts.
- Migrations are additive. No hard deletes: rows are superseded, archived or soft-deleted, never
  removed (a grant with history is archived; reported period snapshots are never recomputed).
- Saving any rule/program/grant marks the current run stale ("needs update"); recompute runs
  automatically after every stale-marking mutation (JPH-28) and is serialized per org with
  `pg_advisory_xact_lock`. A failed sum check leaves the previous run current.
- Styling: Tailwind CSS v4 with semantic utility classes in `src/app/globals.css`, including a
  print stylesheet. PDF exports use pdfkit with built-in Helvetica fonts (no Chromium).

## Ticket guardrails

- Never edit an expected value or weaken an assertion. If a golden or ticket figure looks wrong,
  say so in `QUESTIONS.md`; do not change the fixture, the expectation or the app to make it pass.
- Assert on rendered `data-cents` attributes for every figure in e2e; unit tests assert integer
  cents.
- No test skips, no `.only`. (The only standing skip is the private-fixture parity test, which
  skips silently when `fixtures/private/` is absent.)
- `fixtures/private/` is never committed (git-ignored in `artifacts/app/.gitignore`). Pseudonyms
  only — in fixtures, seeds, tests, comments and docs. `src/privacy/no-private-data.test.ts`
  scans every tracked file against the denylist and must pass before every push.
- Ambiguity goes to `QUESTIONS.md` (ticket heading, what was unclear, what was done, what would
  change if the answer differs), never guessed silently.
- Keep ids, routes, query params and test ids stable (`bva`, `partyIds`, `cell-grid`, …);
  vocabulary changes are copy only.
- Do not run `seed:demo` against a database holding real or pilot data.

## Vocabulary (`src/copy/terms.ts`, JPH-24/25 binding rule)

Every label, heading, column, helper text, banner, check name and empty state uses the CPA's
QuickBooks words, via `TERMS`, never the engine's. Prisma models, routes, query params and
fixtures keep their internal names.

- parties → names (Name / Names — customer or vendor)
- pieces → allocated amounts
- member lines / source lines / transaction lines → transactions
- cell → activity × category
- stale → needs update
- BvA → Budget vs. Actuals (Funder view = budget as awarded; Internal view = how we track it)
- reconciliation checks → health checks (`CHECK_LABELS`: six binding names)
- allocation rules → shared cost splits; compute run / recompute → calculation, "Recalculate now"
- never show: run / compute run / `run <hash>` / config hash / file hash / fingerprint. Hashes go
  behind a collapsed "Technical details". `FORBIDDEN_TERMS`, `REVIEW_FORBIDDEN_TERMS` and
  `RUN_HASH_PATTERN` are asserted by the copy tests.

## Where things live (all paths under `artifacts/app`)

- Layout: `prisma/` schema + migrations; `src/app/` routes (server components + server actions);
  `src/components/` shared server components; `src/domain/` pure domain logic (money, matchers,
  rounding, engine, reports); `src/datasource/` `DataSource` interface + CSV adapter (+ QBO
  stub) + QBO report parser; `src/services/` DB-backed read models and mutations; `src/lib/` db
  client, org helper, audit, form helpers; `src/cli/` import / seed / fixture CLIs; `src/copy/`
  vocabulary; `src/privacy/` denylist scan; `tests/db/` Vitest DB tests; `e2e/` Playwright specs.
- Engine: `src/engine/core.ts` pure `allocate(lines, config) → pieces`; `src/engine/recompute.ts`
  wraps it (load → new `ComputeRun` → bulk `AllocatedLine` → SQL sum check → promote); stages:
  allocation rule → default program → crosswalk (`src/domain/matchers.ts`, `src/domain/split.ts`).
  Rule previews (`src/services/rule-preview.ts`) run the real engine with the candidate rule.
- Import: CSV six-file bundle `src/datasource/csv/adapter.ts`; `ImportService.run`
  `src/datasource/import-service.ts` (content-hashed rows, all-or-nothing, new/changed/unchanged/
  deleted); QuickBooks report import for one grant `src/datasource/qbo-report/parser.ts` +
  `/import` (JPH-20); grant membership `src/services/grant-membership.ts` (`import_scope`,
  `class_match`, `project_match`, rows superseded never deleted).
- Reports (JPH-11): `/reports` presets, saved views, GET-based custom builder; `src/reports/`
  (CSV, formula-backed XLSX, pdfkit PDF); `src/reports/query.ts`; report pivot keys are
  test/view contracts — display names live in labels.
- BvA / dashboard (JPH-12): `src/services/bva.ts`, `/grants/[id]/bva?view=funder|internal`
  (`/funder` and `/working` redirect into it), `/restricted`; pacing thresholds in `/settings`.
- Narratives (JPH-13): `src/narratives/` (injected `NarrativeModel`, grounding packet, figure
  verification), pages under `src/app/grants/[id]/(setup)/narratives`.
- Incremental imports, locks, reconciliation (JPH-15): `/import/[batchId]/changes`,
  `/settings/periods`, `/periods/[id]/drift`, `src/services/reconciliation.ts`.
- Restricted-grants pilot (JPH-19 phases): grant stage `src/engine/grant-stage.ts`; effort math
  `src/domain/effort.ts` (decimal.js, schedule-total rounding); correcting entries
  `src/domain/correcting-entry.ts` (balance check) + `src/services/correcting-entries.ts`
  (drafts, codes, void, posted detection); effort services `src/services/effort.ts`; exports
  `src/reports/correcting-entry.ts` (Intuit JE CSV template) and routes under
  `src/app/grants/[id]/entries/[code]/`; pages `src/app/grants/[id]/effort` and `src/app/grants/[id]/entries`; pilot seed
  `fixtures/pilot/seed.json` + `src/seed/pilot.ts`; tests `tests/db/jph21-pilot.test.ts`,
  `tests/db/jph22-effort.test.ts`, `e2e/pilot.spec.ts`.
- JPH-23 (periods, workspace, rollforward, parity): `src/domain/periods.ts`;
  `src/services/grant-periods.ts` (reported snapshots never recomputed; `PeriodLock` is
  org-wide); workspace read models `src/services/grant-workspace.ts` (header metrics, tie-out, activity
  grid, working view; the funder/internal Budget vs. Actuals tables read `src/services/bva.ts`
  + `src/services/grant-budget.ts`); rollforward XLSX `src/reports/rollforward-xlsx.ts`;
  `src/app/grants/rollforward` (+ `pdf/route.ts`, `range.ts` presets);
  `src/app/grants/[id]/tie-out/pdf/route.ts`; pacing callout `src/components/pacing-callout.tsx`;
  parity `src/cli/parity-report.ts` + `src/reports/parity.ts`, metric keys
  `src/services/parity-metrics.ts`; tests `tests/db/jph23-rollforward.test.ts`,
  `tests/db/jph23-workspace.test.ts`.
- JPH-30 (one set of grant figures): `Grant.trackingMode` (crosswalk | membership, derived on
  read); `src/domain/grant-figures.ts` + `src/services/grant-figures.ts` (`loadGrants` once per
  org, then `grantFigures` / `figuresBookedByClass`, `booksThrough()`); every page, export and the
  parity report read it — `src/domain/grant-figures.source.test.ts` fails if a page under
  `src/app` computes spend/received/balance itself; pacing string
  `src/components/grant-pace-status.tsx` (`paced=false` for unrestricted gifts); tests
  `tests/db/jph30-figures.test.ts`, `e2e/jph30-figures.spec.ts`.
- JPH-25 Phase A (audit fixes): vocabulary map `src/copy/terms.ts`; one period rule
  `src/domain/period.ts` + `src/lib/period.ts` (`gat_asof` cookie written by `src/proxy.ts`);
  one unmapped definition `src/domain/unmapped.ts`; breadcrumbs `src/lib/breadcrumbs.ts` +
  `src/components/ui/breadcrumbs.tsx`; `src/components/ui/period-subtitle.tsx`; human-readable
  history `src/components/history-diff.tsx`; Edit grant button
  `src/app/grants/[id]/edit-grant-button.tsx`; atomic budget-lines editor island
  `src/app/grants/[id]/(setup)/budget/budget-lines-island.tsx`; tests `src/domain/period.test.ts`,
  `src/domain/unmapped.test.ts`, `e2e/jph25-phase-a.spec.ts`.
- JPH-26 Phase B (one rule builder): `src/domain/describe-rule.ts`; shared `<RuleBuilder>` in
  `src/components/rule-builder/` (`rule-builder.tsx`, `server.tsx`, `preview-panel.tsx`,
  `prefill.ts` query-param prefill, `options.ts`, `types.ts`); form parsing `src/lib/rule-form.ts`
  + `src/lib/rule-form-parse.ts`; live preview `POST /api/rules/preview`
  (`src/app/api/rules/preview/route.ts`) → `src/services/rule-preview.ts`; superset warning
  `src/services/rule-superset.ts`; priority default 50; baselines
  `tests/fixtures/jph26-baseline.json` (collector `tests/db/jph26-baseline.ts`); tests
  `tests/db/jph26-phase-b.test.ts`, `tests/db/jph26-describe-rule.test.ts`,
  `e2e/jph26-phase-b.spec.ts`.
- JPH-27 Phase C (review queue, QuickBooks "For Review" pattern): deterministic suggestion
  engine `src/domain/suggest.ts`; queue read model `src/services/review-queue.ts` +
  `src/services/review.ts`, decisions `src/services/line-decisions.ts`; per-grant
  `/grants/[id]/review` and cross-grant `/review` (`src/app/review/{page,queue-table,
  queue-chrome,queue-island}.tsx`, J/K/A/C/X island announces `data-island="ready"`); row and
  bulk actions `src/app/grants/review-actions.ts` (bulk accept/exclude share one `groupId`);
  tests `src/domain/suggest.test.ts`, `e2e/jph27-phase-c.spec.ts`.
- JPH-28 Phase D (close checklist, automatic recalculation, activity log): home `/`
  (`src/app/page.tsx`) is the month-end close checklist — `src/domain/close-status.ts`,
  `src/services/close-status.ts`, `src/components/close-checklist.tsx`,
  `src/components/overview-cards.tsx`, `src/services/dashboard.ts`; recompute after every
  stale-marking mutation `src/lib/after-mutation.ts` + `src/services/recompute-queue.ts`;
  Updated chip `src/domain/freshness.ts`; Runs/Import moved under `/activity`
  (`src/app/activity/page.tsx`) with health-check vocabulary; `/reports/overview`
  (`src/app/reports/overview/page.tsx`); failed health checks block step 3 and closure; tests
  `src/domain/close-status.test.ts`, `src/domain/freshness.test.ts`,
  `tests/db/recompute-queue.test.ts`, `e2e/jph28-phase-d.spec.ts`,
  `e2e/jph28-phase-d-pilot.spec.ts`.
- JPH-29 Phase E (grant workspace): three tabs Status / To do / Setup
  (`src/app/grants/[id]/page.tsx`, `todo/page.tsx`, `tabs.tsx`; `src/services/grant-todo.ts`);
  Setup is the `(setup)` route group around `/edit`, `/budget`, `/rules`, `/activity`,
  `/periods`, `/history`, `/narratives` with a shared rail (`(setup)/layout.tsx`,
  `setup-rail.tsx`; `/grants/[id]/setup?section=` only redirects); Budget vs. Actuals views
  `src/app/grants/[id]/bva/` (`page.tsx`, `view.ts`, `tables.tsx`, `export.ts`,
  `forecast-strip.tsx`, `months.ts`, `csv|xlsx|pdf` routes); "How QuickBooks tracks
  this grant" block `src/app/grants/tracking-block.tsx` + `tracking-form.ts`,
  `src/domain/tracking-choice.ts`, `src/services/tracking-options.ts`; five-step server-rendered
  wizard `/grants/new/1…5` (`src/app/grants/new/[step]/page.tsx`, `wizard-actions.ts`,
  `wizard/{shell,step-award,step-budget,step-lines,step-rules}.tsx`; `GrantDraft` model,
  additive migration; `/grants/new?mode=form` keeps the single-page form) —
  `src/domain/grant-draft.ts`, `src/services/grant-draft.ts`; `src/lib/redirect-response.ts`;
  tests `src/domain/grant-draft.test.ts`, `src/domain/tracking-choice.test.ts`,
  `tests/db/jph29-wizard.test.ts`, `tests/db/jph29-tracking-block.test.ts`,
  `e2e/jph29-phase-e.spec.ts`, `e2e/jph29-phase-e-pilot.spec.ts`.

## Test data

- `fixtures/demo/` — golden dataset (Harbor Kitchen Collective) + `expected.json` /
  `EXPECTED.md`, asserted by `tests/db/golden.test.ts`. Tests only; not loaded on the deploy.
  `fixtures/broken/` reproduces the five documented import errors; `fixtures/demo-edited/`,
  `fixtures/demo-tb-mismatch/` and `fixtures/generated/` serve the re-import and scale tests.
- `fixtures/pilot/` — pseudonymized Salah / Opioid QuickBooks exports + `seed.json`, regenerated
  with `pnpm run fixtures:anonymize` from the private workbook. Golden numbers per ticket are in
  `QUESTIONS.md` (e.g. Salah expense 22,708.81, Salah income 50,000.00, Opioid income 20,000.00,
  asserted as integer cents in `tests/db/qbo-report.test.ts`). The pilot export has no class
  column; the seed matches grants by name and budget-line codes.
- `fixtures/private/` — git-ignored: the real workbook, pseudonym map, denylist, parity map and
  parity output. When the denylist is present the privacy test fails on any real name in a
  tracked file; without it the private-only tests skip.
- Demo grant ids change on every restore; resolve them from `/grants` links, never hardcode.
