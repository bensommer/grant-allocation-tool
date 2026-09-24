import { expect, test } from '@playwright/test';

test.beforeEach(() => {
  test.skip(test.info().project.name !== 'chromium-nojs', 'No-JS project only');
});

test('native mobile menu navigates with JavaScript disabled', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/grants');
  const menu = page.locator('nav details');
  await expect(menu).not.toHaveAttribute('open');
  await menu.locator('summary').click();
  await expect(menu).toHaveAttribute('open', '');
  await menu.getByRole('link', { name: 'Programs' }).click();
  await expect(page).toHaveURL(/\/programs$/);
});

test('dashboard filter submits as a native GET form', async ({ page }) => {
  await page.goto('/');
  await page.getByLabel('As of').fill('2026-02-28');
  await page.getByRole('button', { name: 'Apply' }).click();
  await expect(page).toHaveURL(/asOf=2026-02-28/);
  await expect(page.getByLabel('As of')).toHaveValue('2026-02-28');
});

test('program creation and danger-zone deletion work without JavaScript', async ({ page }) => {
  const code = `E2E${Date.now()}`;
  await page.goto('/programs/new');
  await page.getByLabel('Name', { exact: true }).fill(`E2E Program ${code}`);
  await page.getByLabel('Code', { exact: true }).fill(code);
  await page.getByRole('button', { name: 'Create program' }).click();
  await expect(page).toHaveURL(/\/programs\/[^/]+/);
  const detail = new URL(page.url()).pathname;
  await page.goto(`${detail}/delete`);
  await page.getByRole('button', { name: 'Delete / deactivate program' }).click();
  await expect(page).toHaveURL(/\/programs/);
});

test('CSV export responds with text/csv without JavaScript', async ({ page, request }) => {
  await page.goto('/reports/custom');
  const href = await page.getByRole('link', { name: /CSV/i }).first().getAttribute('href');
  expect(href).toBeTruthy();
  const response = await request.get(href!);
  expect(response.ok()).toBeTruthy();
  expect(response.headers()['content-type']).toContain('text/csv');
});
