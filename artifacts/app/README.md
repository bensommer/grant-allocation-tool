# Grant × Program × GL Allocation Tool

Server-rendered Next.js app for nonprofit finance teams: import QuickBooks-shaped ledger
data, define grants / programs / budget lines, crosswalk GL activity to grants, apply
shared-cost allocation rules, and produce printable grant × program × GL reports,
budget-vs-actual, restricted-fund balances, and AI-drafted funder narratives.

This package lives at `artifacts/app` inside a pnpm workspace. All commands below are npm
scripts so they work the same from `tcsh`, `bash`, or `zsh`.

## Setup

Requirements: Node 24+, pnpm 10+, Postgres 16 (Docker Compose file included).

```
cd artifacts/app
docker compose up -d                    # local Postgres on :5432 (skip on Replit)
cp .env.example .env                    # edit DATABASE_URL if needed
setenv PORT 3000                        # tcsh; bash users: export PORT=3000
pnpm install
pnpm run db:migrate                     # apply Prisma migrations
pnpm run dev                            # http://localhost:3000
```

`.env` is loaded by Prisma (via `prisma.config.ts`) and by Next.js. On Replit,
`DATABASE_URL` and `PORT` are injected by the platform; no `.env` is required.

## Scripts

| Script                                                | What it does                                                           |
| ----------------------------------------------------- | ---------------------------------------------------------------------- |
| `pnpm run dev`                                        | Next.js dev server on `$PORT`                                          |
| `pnpm run build` / `start`                            | Production build / serve                                               |
| `pnpm run typecheck`                                  | `prisma generate` + `tsc --noEmit` (strict)                            |
| `pnpm run lint`                                       | ESLint (next/core-web-vitals + typescript)                             |
| `pnpm run format`                                     | Prettier check                                                         |
| `pnpm run db:migrate`                                 | `prisma migrate deploy`                                                |
| `pnpm run db:migrate:dev`                             | `prisma migrate dev` (creates a new migration)                         |
| `pnpm run test`                                       | Vitest unit + domain tests (golden dataset included)                   |
| `pnpm run e2e`                                        | Playwright e2e (projects: `chromium`, `chromium-nojs`)                 |
| `pnpm run import:csv -- --dir <folder>`               | Import a CSV bundle from the CLI (`--from`/`--to` for a partial range) |
| `pnpm run seed:demo`                                  | Load the demo overlay (programs, grants, budget lines, rules)          |
| `pnpm run recompute`                                  | Run the allocation pipeline once (same as "Recompute now" on `/runs`)  |
| `pnpm run fixtures:generate -- --seed 42 --months 12` | Deterministic larger dataset into `fixtures/generated`                 |

`pnpm run test` truncates every table in `DATABASE_URL`; set `TEST_DATABASE_URL` to use a
separate database (tcsh: `setenv TEST_DATABASE_URL postgresql://...`).

Playwright notes: set `E2E_BASE_URL` to test an already-running server; otherwise the
config starts `pnpm run dev` on `$PORT`. On Replit the bundled Chromium lacks system libs,
so run `setenv PLAYWRIGHT_CHROMIUM_PATH /repl/tools/bin/chromium` first.

## Architecture

- **Server-rendered, no SPA.** Every screen is its own route under `src/app`. Pages are
  React Server Components that read from Postgres via Prisma. Mutations are Next.js server
  actions invoked from native `<form action={...}>` elements, so every workflow functions with
  JavaScript disabled (the `chromium-nojs` Playwright project enforces this). There is no
  client-side global store and no client-side data fetching for page data. Client components
  are leaf islands only, and each carries a comment justifying why it needs the browser.
  _Why:_ the users are accountants working in printable reports and long forms; SSR gives
  correct printing, deep-linkable filters, back-button behavior, and zero hydration surprises.
- **Two data layers** (`prisma/schema.prisma`): a read-only _source mirror_ of
  QuickBooks-shaped data (accounts, classes, locations, parties, transactions, lines) that only
  `DataSource` adapters write through the import service, and a user-owned _overlay_
  (programs, grants, budget lines, crosswalk rules, allocation rules) plus materialized compute
  output (`ComputeRun`, `AllocatedLine`). Source rows are never mutated by the app.
- **Money is integer cents** everywhere (`src/domain/money.ts`). Percentages are basis points.
  Splits use largest-remainder rounding with ties broken by lowest target sort order, so every
  split sums exactly to its source line.
- **Every table carries `orgId`.** The MVP runs as a single org (`src/lib/org.ts`).
- **Styling:** Tailwind CSS v4 with a small set of semantic utility classes in
  `src/app/globals.css`, including a print stylesheet. Chosen over CSS modules to keep
  server components free of per-file style plumbing.
- **Env:** `src/env.ts` validates `process.env` with zod at first use.

## Allocation engine

`src/engine/core.ts` is a pure function `allocate(lines, config) → pieces`; `src/engine/recompute.ts`
wraps it with the database: load source lines + overlay config → new `ComputeRun` → bulk-insert
`AllocatedLine` → verify in SQL that Σ pieces = source amount for every line → promote (previous
current run becomes `superseded`; a failed check leaves the previous run current). Stages per line:

1. **Allocation** — lowest-priority active `AllocationRule` whose matchers pass and whose effective
   window contains the line date splits the amount across its targets (`fixed_pct` by basis points,
   `ratio_of_driver` by that month's driver values). Equal lowest priority = conflict: the line is
   flagged and falls through.
2. **Default** — 100% to the program whose default classes include the line's class; none →
   `unassigned_program`.
3. **Crosswalk** — expense pieces are matched against `CrosswalkRule`s (matchers see the _allocated_
   program) whose grant period contains the date. Lowest priority wins; a tie is a
   `crosswalk_conflict` (excluded from grant totals); no match = unmapped (not an error).

Rounding is integer-cent largest-remainder with ties to the lowest target sort order
(`src/domain/split.ts`). Saving any rule/program/grant marks the current run stale; nothing is
recomputed until you press **Recompute now** on `/runs` (or run `pnpm run recompute`). `/runs/[id]/diff`
shows program × GL and budget-line deltas between two runs; `/lines/[id]` is the per-line audit trail.

## Importing data

The app never talks to QuickBooks directly; it consumes a `DataSource` (`src/datasource/types.ts`).
The CSV adapter (`src/datasource/csv/adapter.ts`) reads a six-file bundle shaped like QuickBooks
exports — `company.csv, accounts.csv, classes.csv, locations.csv, parties.csv, transactions.csv`
(one row per transaction line, header columns repeated). Amounts may be `1234.56`, `$1,234.56`
or `(1,234.56)`; dates `YYYY-MM-DD` or `MM/DD/YYYY`; UTF-8 with or without BOM; CRLF fine.

`ImportService.run` (`src/datasource/import-service.ts`) is adapter-agnostic. It validates
references, checks JournalEntry balance, and either commits the whole batch or nothing. Every row is
content-hashed so re-imports report `new / changed / unchanged / deleted`; changed and deleted rows
keep history in `SourceRowVersion`, and deletions are soft (`deletedAt`). A full import (no date
range) treats the files as the complete truth; a ranged import only reconciles transactions inside
the range.

Demo walkthrough:

```
pnpm run import:csv -- --dir fixtures/demo
pnpm run seed:demo
```

`fixtures/demo/EXPECTED.md` lists the golden totals asserted by `tests/db/golden.test.ts`;
`fixtures/broken/` reproduces the five documented import errors. The QuickBooks Online adapter
(`src/datasource/qbo/adapter.ts`) is a stub pending the live-connector story.

## Crosstab reports (JPH-11)

Open `/reports` for four Q1 presets, saved views and the GET-based custom builder.
Choose row and column dimensions, optional page-break dimension, dates and filters;
the URL is shareable and works with JavaScript disabled. Each nonzero cell drills
into contributing pieces and source lines. Download CSV, formula-backed XLSX
(with Detail and Parameters sheets), or landscape Letter PDF from the report.
Totals use integer cents until export. Reports use the current ComputeRun unless
`run` pins an org-owned run; stale configuration is flagged in the header.
PDF export requires Chromium; on Replit set
`PLAYWRIGHT_CHROMIUM_PATH=/repl/tools/bin/chromium`.

## Budget vs actual (JPH-12)

Open the dashboard at `/`, a grant's budget vs actual at `/grants/[id]/bva`, or all restricted grants at `/restricted`. Set an as-of date with the server-rendered date filter. Budget and restricted tables offer CSV downloads; XLSX and PDF integration is pending the shared report exporter. Pacing thresholds default to 15% under and 10% over, editable in `/settings`. Definitions and sign conventions are in `docs/definitions.md`. Recompute after changing configuration to refresh current-run allocations.

## AI-drafted funder narratives (JPH-13)

Set `ANTHROPIC_API_KEY` and `NARRATIVE_MODEL` (an Anthropic model ID) to enable drafting from a grant's Narratives page. Without the key, existing drafts remain readable and generation is disabled. Choose one of three versioned templates, period, and context notes. Drafts store the current compute run's grounding packet and prompt version; all cited amounts and percentages are checked against packet figures and derived sums before approval. Unverified figures must be corrected or explicitly acknowledged. Approved records are immutable; an edit creates a new version. DOCX and printable PDF include a budget-vs-actual table. For local e2e generation only, `NARRATIVE_FAKE_MODEL=1` selects a canned model when `NODE_ENV` is not production; no network model call occurs. The e2e suite can also seed a narrative directly when the dev server was started without this flag.

## Incremental imports, reporting locks and reconciliation (JPH-15)

Import the same CSV bundle twice with `pnpm import:csv -- --dir fixtures/demo`: the second full-range import reports zero new, changed and deleted rows. An import with `--from` and `--to` is partial and never deletes missing transactions; a full import soft-deletes missing rows. Changed and deleted transaction history is visible at `/import/[batchId]/changes`. The optional `trial_balance.csv` has columns `account_external_id,period_end,balance`; balances are year-to-date expense totals in decimal dollars. Missing balances result in a warning, while differences fail the account-level tie-out. Recompute after importing to update checks.

Lock a current, non-stale run at `/settings/periods` before submitting a report. Imports affecting locked dates flag the batch on the dashboard and link to `/periods/[id]/drift`, comparing current allocation cents to the locked snapshot. Recompute to see new deltas. Checks appear on the dashboard and `/runs/[id]`.

QBO CDC incremental sync, full-resync fallback, and QBO TrialBalance Reports API are **NotImplemented** behind `QboDataSource.syncChanges()` and `fetchTrialBalance()` pending JPH-14. Intuit CDC lookback limits must be verified before enabling the connector.

## Layout

```
prisma/            schema + migrations
src/app/           routes (server components + server actions)
src/components/    shared server components
src/domain/        pure domain logic (money, matchers, rounding, engine, reports)
src/datasource/    DataSource interface + CSV adapter (+ QBO stub)
src/lib/           db client, org helper, audit
src/cli/           import / seed / fixture-generation CLIs
fixtures/demo/     golden dataset (Harbor Kitchen Collective) + expected.json
e2e/               Playwright specs
```
