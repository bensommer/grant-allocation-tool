import { expect, test } from '@playwright/test';

test('dashboard and restricted balances use the current run', async ({ page }) => {
  await page.goto('/?asOf=2026-03-31');
  await expect(page.getByRole('heading', { name: 'Flagged grants' })).toBeVisible();
  await expect(
    page
      .locator('.card')
      .filter({ has: page.getByRole('heading', { name: 'Flagged grants' }) })
      .getByText('2', { exact: true }),
  ).toBeVisible();
  await page.goto('/restricted?asOf=2026-03-31');
  await expect(page.getByRole('row', { name: /Culinary Workforce Grant/ })).toContainText(
    '20,247.09',
  );
  await expect(page.getByRole('row', { name: /Youth Meals Grant/ })).toContainText('3,618.80');
  await expect(page.getByText('Rivera general operating gift')).toHaveCount(0);
});
