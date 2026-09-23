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
  projects: [
    { name: 'chromium', use: { browserName: 'chromium' } },
    { name: 'chromium-nojs', use: { browserName: 'chromium', javaScriptEnabled: false } },
  ],
});
