import { expect, test } from '@playwright/test';

test('invalid 60/50 split retains values, then fixed 50/50 saves', async ({ page }) => {
  await page.goto('/allocation/new');
  const name = `Allocation E2E ${Date.now()}`;
  await page.fill('input[name="name"]', name);
  await page.locator('input[name="accountIds"]').first().check();
  const programs = page.locator('select[name="program_0"] option:not([value=""])');
  const first = await programs.nth(0).getAttribute('value');
  const second = await programs.nth(1).getAttribute('value');
  expect(first).toBeTruthy();
  expect(second).toBeTruthy();
  await page.selectOption('select[name="program_0"]', first!);
  await page.selectOption('select[name="program_1"]', second!);
  await page.fill('input[name="share_0"]', '60');
  await page.fill('input[name="share_1"]', '50');
  await page.getByRole('button', { name: 'Create rule' }).click();
  await page.waitForURL(/\/allocation\/new\?f=/);
  await expect(page.locator('.field-error')).toContainText('Shares must total 100.00%');
  await expect(page.locator('input[name="share_0"]')).toHaveValue('60');
  await expect(page.locator('input[name="share_1"]')).toHaveValue('50');
  await page.fill('input[name="share_0"]', '50');
  await page.getByRole('button', { name: 'Create rule' }).click();
  await page.waitForURL(/\/allocation\/[a-z0-9]+\?saved=1/);
  await page.goto('/allocation');
  await expect(page.getByRole('link', { name })).toBeVisible();
});
