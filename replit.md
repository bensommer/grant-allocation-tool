# Grant Allocation Tool

Server-rendered Next.js app (artifacts/app) for nonprofit finance teams: grant × program × GL allocation, reports, restricted-fund balances, AI funder narratives. Spec: docs/jira-epic-JPH-3-spec.txt; decisions: docs/build-decisions.md.

## Run & Operate

- Main app: workflow `artifacts/app: web` (Next.js, reads `$PORT`). Do not run `pnpm dev` at root.
- `pnpm --filter @workspace/app run typecheck|lint|test|e2e|db:migrate:dev` — app checks (see artifacts/app/README.md)
- e2e on Replit: `E2E_BASE_URL=http://localhost:23863 PLAYWRIGHT_CHROMIUM_PATH=/repl/tools/bin/chromium pnpm --filter @workspace/app run e2e`
- `pnpm --filter @workspace/api-server run dev` — run the API server (port 5000)
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from the OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- Required env: `DATABASE_URL` — Postgres connection string

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- API: Express 5
- DB: PostgreSQL + Drizzle ORM
- Validation: Zod (`zod/v4`), `drizzle-zod`
- API codegen: Orval (from OpenAPI spec)
- Build: esbuild (CJS bundle)

## Where things live

_Populate as you build — short repo map plus pointers to the source-of-truth file for DB schema, API contracts, theme files, etc._

## Architecture decisions

- `artifacts/app` is Next.js App Router + Prisma 7 (pg adapter), NOT the template's Vite/Express/Drizzle/Orval stack — the Jira spec mandates server-rendered pages, server actions, forms that work without JS, no SPA. Don't add React Query/Zustand/client fetching for page data.
- Money = integer cents (Int32), percentages = basis points; largest-remainder rounding, ties → lowest target sortOrder. Source ledger tables are never mutated.
- Single org for MVP; every table still has orgId (`src/lib/org.ts`).
- JPH-14 (live QBO connector) is skipped; QBO pieces are stubs behind the DataSource interface.

## Product

_Describe the high-level user-facing capabilities of this app once they exist._

## User preferences

_Populate as you build — explicit user instructions worth remembering across sessions._

## Gotchas

- Prisma client is generated to `artifacts/app/src/generated/prisma` (gitignored); `typecheck`/`build` run `prisma generate` first.
- eslint must stay on v9 (eslint-config-next plugins break on v10).
- pnpm `minimumReleaseAge: 1440` blocks packages published <24h ago.

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
