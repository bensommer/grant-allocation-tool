import { expect, test } from '@playwright/test';

test('create a rule and inspect the matrix', async ({ page }) => {
  await page.goto('/crosswalk/new');
  await page.fill('input[name="name"]', `Test crosswalk ${Date.now()}`);
  await page.locator('select[name="grantBudgetLineId"]').selectOption({ index: 1 });
  await page.locator('input[name="programIds"]').first().check();
  await page.getByRole('button', { name: 'Create rule' }).click();
  await page.waitForURL(/\/crosswalk\/[a-z0-9]+\?saved=1/);
  await page.goto('/crosswalk');
  await expect(page.getByText(/Test crosswalk/).first()).toBeVisible();
  await page.goto('/crosswalk/matrix');
  await expect(page.locator('tr').filter({ hasText: '6010' }).first()).toContainText('PERS');
  await expect(page.locator('tr').filter({ hasText: '6210' }).first()).toContainText('unmapped');
});

test.describe('JavaScript disabled', () => {
  test.use({ javaScriptEnabled: false });
  test('creates a crosswalk rule via server action', async ({ page }) => {
    const name = `No JS crosswalk ${Date.now()}`;
    await page.goto('/crosswalk/new');
    await page.fill('input[name="name"]', name);
    await page.locator('select[name="grantBudgetLineId"]').selectOption({ index: 1 });
    await page.locator('input[name="programIds"]').first().check();
    await page.getByRole('button', { name: 'Create rule' }).click();
    await page.waitForURL(/\/crosswalk\/[a-z0-9]+\?saved=1/);
    await page.goto('/crosswalk');
    await expect(page.getByText(name)).toBeVisible();
  });
});
