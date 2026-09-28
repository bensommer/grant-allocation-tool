import { expect, test } from '@playwright/test';
import { prisma } from '../src/lib/db';

test.afterEach(async () => {
  await prisma.crosswalkRule.deleteMany({
    where: {
      OR: [
        { name: { startsWith: 'Test crosswalk ' } },
        { name: { startsWith: 'No JS crosswalk ' } },
      ],
    },
  });
});

test('create a rule and inspect the matrix', async ({ page }) => {
  await page.goto('/crosswalk/new');
  await page.fill('input[name="name"]', `Test crosswalk ${Date.now()}`);
  await page.locator('select[name="grantBudgetLineId"]').selectOption({ index: 1 });
  // Program is an on-demand condition row in the builder (JPH-26 B2); this spec also runs in
  // the no-JS project, where "Add condition" is a disclosure holding the row itself.
  await page.getByText('Add condition').click();
  const programItem = page.getByRole('menuitem', { name: 'Program' });
  if (await programItem.isVisible()) await programItem.click();
  await page.locator('input[name="programIds"]').first().check();
  await page.getByRole('button', { name: 'Create rule' }).click();
  await page.waitForURL(/\/crosswalk\/[a-z0-9]+\?saved=1/);
  await page.goto('/crosswalk');
  await expect(page.getByText(/Test crosswalk/).first()).toBeVisible();
  await page.goto('/crosswalk/matrix');
  await expect(page.locator('tr').filter({ hasText: '6010' }).first()).toContainText('Mapped');
  await expect(page.locator('tr').filter({ hasText: '6210' }).first()).toContainText('Unmapped');
});

test.describe('JavaScript disabled', () => {
  test.use({ javaScriptEnabled: false });
  test('creates a crosswalk rule via server action', async ({ page }) => {
    const name = `No JS crosswalk ${Date.now()}`;
    await page.goto('/crosswalk/new');
    await page.fill('input[name="name"]', name);
    await page.locator('select[name="grantBudgetLineId"]').selectOption({ index: 1 });
    // Without JS the extra condition rows sit inside the "Add condition" disclosure.
    await page.getByText('Add condition').click();
    await page.locator('input[name="programIds"]').first().check();
    await page.getByRole('button', { name: 'Create rule' }).click();
    await page.waitForURL(/\/crosswalk\/[a-z0-9]+\?saved=1/);
    await page.goto('/crosswalk');
    await expect(page.getByText(name)).toBeVisible();
  });
});
