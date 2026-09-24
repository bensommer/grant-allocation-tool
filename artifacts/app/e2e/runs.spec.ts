import { expect, test } from '@playwright/test';

test('recompute now creates a current run; diff and line audit render', async ({ page }) => {
  await page.goto('/runs');
  await page.getByRole('button', { name: 'Recompute now' }).click();
  await page.waitForURL(/\/runs\?done=/);
  await expect(page.locator('.banner-ok')).toContainText('Recompute succeeded');
  const currentRow = page.locator('tbody tr').first();
  await expect(currentRow.locator('.pill', { hasText: 'current' })).toBeVisible();
  await expect(currentRow.locator('.pill', { hasText: 'Succeeded' })).toBeVisible();

  await currentRow.getByRole('link', { name: 'Diff vs previous' }).click();
  await page.waitForURL(/\/runs\/[a-z0-9]+\/diff\?against=/);
  await expect(page.locator('h1')).toHaveText('Why did this number change?');
  await expect(page.locator('h2').first()).toHaveText('Program × GL account');

  await page.goto('/runs');
  await page.locator('tbody tr').first().getByRole('link', { name: 'Detail' }).click();
  await page.waitForURL(/\/runs\/[a-z0-9]+$/);
  await expect(page.locator('.pill', { hasText: 'Succeeded' }).first()).toBeVisible();
  const audit = page.getByRole('link', { name: 'audit' }).first();
  if (await audit.count()) {
    await audit.click();
    await page.waitForURL(/\/lines\/[a-z0-9]+/);
    await expect(page.locator('h2').first()).toContainText('Source line');
    await expect(page.locator('.pill', { hasText: 'equals source amount' })).toBeVisible();
  }
});
