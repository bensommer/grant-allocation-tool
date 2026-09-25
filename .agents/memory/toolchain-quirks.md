---
name: Replit toolchain quirks for artifacts/app
description: Environment-specific gotchas for running tests/lint in this workspace.
---
- Playwright's downloaded Chromium can't load (missing libglib). Use the workspace binary: `PLAYWRIGHT_CHROMIUM_PATH=/repl/tools/bin/chromium` (config honors it) and `E2E_BASE_URL=http://localhost:23863` against the running workflow.
- `pnpm add -D prisma` resolved to an 8.0.0 release candidate while @prisma/client was 7.x; pin both to ^7.
- eslint-config-next's plugins break under ESLint 10 (`getFilename is not a function`); keep eslint ^9.
- `pnpm run e2e -- --project visual` forwards the literal `--` to Playwright, which treats it as a test filter and the run fails/updates nothing. Call `npx playwright test --project visual --update-snapshots` directly (same env vars).
- **How to apply:** whenever running e2e or upgrading these packages.

## CodeExecution notebook state is not reliable across calls
Helpers defined in an earlier CodeExecution call (e.g. a GitHub push helper) sometimes fail with
"executeJs is not defined" in later calls. Redefine the helper in the same call that uses it.
**Why:** hit twice in one session; the notebook persisted variables for a while, then lost them.

## Env changes need a dev-server restart
Next dev server does not pick up newly added secrets/env vars (or a Prisma schema change) until the
workflow is restarted; a feature reading process.env looked "disabled" until then.

## Dev DB after `pnpm test`, and e2e memory
- DB test files truncate the dev DB and leave a test org behind; `import:csv`/`seed:demo` layer onto
  whatever org exists. Truncate before restoring demo data or e2e cleanup hits FK errors.
- The Next dev server can be OOM-killed when Playwright first compiles a heavy route (PDF); warm new
  routes with curl before a full e2e run.
- When routes take minutes to compile or the dev server OOMs repeatedly, the Turbopack cache in
  `artifacts/app/.next` has grown past ~2 GB; delete it and restart the workflow (compiles drop to seconds).
- A full `playwright test` run exceeds the 5-minute shell limit; run it in the background with output
  redirected to a file and poll the file (a Monitor on the task only sees stdout, not the redirected file).
- Visual baselines are captured after the spec's own demo restore; an unexplained figure change in a
  screenshot is usually the DB state left by `pnpm test` (a different org/data), not an engine regression —
  truncate, restore demo and re-check before touching a baseline.
- Playwright specs run in plain Node: nothing they import from `src/` may reach `next/navigation`.
