---
name: Replit toolchain quirks for artifacts/app
description: Environment-specific gotchas for running tests/lint in this workspace.
---
- Playwright's downloaded Chromium can't load (missing libglib). Use the workspace binary: `PLAYWRIGHT_CHROMIUM_PATH=/repl/tools/bin/chromium` (config honors it) and `E2E_BASE_URL=http://localhost:23863` against the running workflow.
- `pnpm add -D prisma` resolved to an 8.0.0 release candidate while @prisma/client was 7.x; pin both to ^7.
- eslint-config-next's plugins break under ESLint 10 (`getFilename is not a function`); keep eslint ^9.
- **How to apply:** whenever running e2e or upgrading these packages.
