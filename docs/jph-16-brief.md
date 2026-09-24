# JPH-16 UI/UX overhaul — working brief

Full ticket text: `docs/jira-JPH-16-spec.txt`. Product decisions: `docs/build-decisions.md`.
App: `artifacts/app` (Next.js 16 App Router, Prisma 7, Tailwind v4, Vitest, Playwright).

## Non-negotiable constraints

- Server-rendered pages. Every page and form works with JavaScript disabled. Client components only as
  small justified islands (each one gets a comment saying why it is a client component).
- **No change to any computed number.** Presentation only — except the dashboard "unmapped" fix (count
  program-service expense only; `Program.functionalCategory === 'program'`) and dashboard as-of default
  (last imported transaction date). The golden suite (`tests/db/golden.test.ts`) must keep passing.
- TS strict, `pnpm typecheck && pnpm lint && pnpm format` must stay clean (run `pnpm prettier --write` on
  files you touch).
- `orgId` on every query. Never mutate source rows.
- Names lead everywhere (program name, grant name, budget line name); codes are secondary muted text.
- Money: `$` in headers and total rows; thousands separators; negatives in parentheses; zero shows as `—`;
  every money cell carries `data-cents`. Numbers right-aligned, `tabular-nums`, **no monospace**.
- Dates: `Jan 1 – Dec 31, 2026` for periods, `Jan` / `Jan 2026` for months. No raw ISO in the UI
  (form `<input type=date>` values are fine).
- Wide tables live inside an `overflow-x:auto` container; at 390px no route may overflow the body.
- WCAG AA contrast on every text/background pair. Status never conveyed by color alone (icon + text).
- Destructive actions live only in a **Danger zone** at the bottom of the page and go through a
  server-rendered confirm page (`…/delete` GET → POST form), never in the page header.
- Nav links use `prefetch={false}`.

## Shared component kit (owned by the foundation worker; page workers consume it)

Lives in `artifacts/app/src/components/ui/` with a `README.md` documenting every export and its props.
Page workers: **do not edit existing files in `src/components/ui/` or `globals.css`**. If you need a
variant, add a new file with a unique name and note it in your report.

Formatters: `src/domain/format.ts` (+ `format.test.ts`): `formatMoney`, `formatPeriod`, `formatMonth`,
`formatPct`. Components: `Money`, `Period`, `Month`, `Pct`, `Button`/`ButtonLink`, `StatusPill`, `Card`,
`PageHeader`, `DataTable` (+ `Th`, `Td`, `NumTd`, `TotalRow`), `FilterBar`, `ProgressBar`, `EmptyState`,
`Legend`, `DangerZone`, `Toolbar`, `Banner`, `KeyFigure`, `MiniBarChart` (server SVG).

## Environment notes

- Dev server: workflow `web`, port 23863 (`http://localhost:23863`). Restart it after env/schema changes.
- `pnpm test` (the DB suite) **truncates the dev DB**. Do not run it during page work. Restore with
  `pnpm import:csv -- --dir fixtures/demo && pnpm seed:demo && pnpm recompute` (from `artifacts/app`).
  Run single pure unit files with `pnpm vitest run src/domain/format.test.ts`.
- Playwright: `E2E_BASE_URL=http://localhost:23863 PLAYWRIGHT_CHROMIUM_PATH=/repl/tools/bin/chromium npx playwright test --workers=1 <spec>`.
  Only run the specs you own; the coordinator runs the full suite at the end.
- Demo data facts (as of 2026-03-31): grants G-MWSC and one other, both **over pace**; unmapped
  program-service expense = **$2,160.00** (Youth Meals occupancy); M&G + Fundraising expense =
  $13,824.50 and is *not* an error. `fixtures/demo/expected.json` has `expenseByProgramGl` (the matrix
  cells must match it), `budgetVsActual`, `restrictedBalances`, `unmappedProgramExpense`.
