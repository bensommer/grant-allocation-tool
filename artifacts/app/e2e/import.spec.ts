import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
import { expect, test } from '@playwright/test';

const DEMO = path.resolve(here, '../fixtures/demo');
const FILES = [
  'company.csv',
  'accounts.csv',
  'classes.csv',
  'locations.csv',
  'parties.csv',
  'transactions.csv',
];

test('upload demo CSV bundle → batch page shows Succeeded', async ({ page }) => {
  await page.goto('/import');
  await page.setInputFiles(
    'input[name="files"]',
    FILES.map((f) => path.join(DEMO, f)),
  );
  await page.getByRole('button', { name: 'Import' }).click();
  await page.waitForURL(/\/import\/[a-z0-9]+$/);
  await expect(page.locator('.pill')).toHaveText('Succeeded');
  await expect(page.getByText('38 transaction lines')).toBeVisible();
});

test('upload broken bundle → Failed with 5 errors and CSV download', async ({ page }) => {
  const BROKEN = path.resolve(here, '../fixtures/broken');
  await page.goto('/import');
  await page.setInputFiles(
    'input[name="files"]',
    FILES.map((f) => path.join(BROKEN, f)),
  );
  await page.getByRole('button', { name: 'Import' }).click();
  await page.waitForURL(/\/import\/[a-z0-9]+$/);
  await expect(page.locator('.pill')).toHaveText('Failed');
  await expect(page.getByText('failed with 5 error(s)')).toBeVisible();
  const href = await page.getByRole('link', { name: /Download errors/ }).getAttribute('href');
  const res = await page.request.get(href!);
  expect(res.headers()['content-type']).toContain('text/csv');
  expect((await res.text()).split('\r\n').filter(Boolean)).toHaveLength(6);
});
