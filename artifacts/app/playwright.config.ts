import { defineConfig } from '@playwright/test';

const port = Number(process.env.PORT ?? 3000);
const baseURL = process.env.E2E_BASE_URL ?? `http://localhost:${port}`;

export default defineConfig({
  testDir: './e2e',
  timeout: 60_000,
  retries: 0,
  use: {
    baseURL,
    trace: 'retain-on-failure',
    // On Replit the bundled Playwright Chromium lacks system libs; point at the
    // workspace's Chromium instead: setenv PLAYWRIGHT_CHROMIUM_PATH /repl/tools/bin/chromium
    launchOptions: process.env.PLAYWRIGHT_CHROMIUM_PATH
      ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH }
      : {},
  },
  webServer: process.env.E2E_BASE_URL
    ? undefined
    : {
        command: `PORT=${port} pnpm run dev`,
        url: baseURL,
        reuseExistingServer: true,
        timeout: 120_000,
      },
  // Visual baselines are captured against freshly restored demo data, so they run alone and first;
  // the functional projects (which create records and recompute) depend on that project.
  // The QuickBooks report spec imports pilot lines into the demo org, which would skew the
  // fixture-cent assertions of specs running alongside it; it runs after them, one project at a
  // time, and removes everything it wrote.
  // Pass --no-deps to run a functional project on its own.
  projects: [
    { name: 'visual', testMatch: /visual\.spec\.ts/, use: { browserName: 'chromium' } },
    {
      name: 'chromium',
      testIgnore: [/visual\.spec\.ts/, /qbo-report\.spec\.ts/, /pilot\.spec\.ts/],
      dependencies: ['visual'],
      use: { browserName: 'chromium' },
    },
    {
      name: 'chromium-nojs',
      testIgnore: [/visual\.spec\.ts/, /qbo-report\.spec\.ts/, /pilot\.spec\.ts/],
      dependencies: ['visual'],
      use: { browserName: 'chromium', javaScriptEnabled: false },
    },
    {
      name: 'qbo-report',
      testMatch: /qbo-report\.spec\.ts/,
      dependencies: ['chromium', 'chromium-nojs'],
      use: { browserName: 'chromium' },
    },
    {
      name: 'qbo-report-nojs',
      testMatch: /qbo-report\.spec\.ts/,
      dependencies: ['qbo-report'],
      use: { browserName: 'chromium', javaScriptEnabled: false },
    },
    // The pilot spec seeds both pilot grants (imports, budgets, rules, decisions) into the demo
    // org and removes them afterwards; it runs last and alone for the same reason.
    {
      name: 'pilot',
      testMatch: /pilot\.spec\.ts/,
      dependencies: ['qbo-report-nojs'],
      use: { browserName: 'chromium', javaScriptEnabled: false },
    },
  ],
});
