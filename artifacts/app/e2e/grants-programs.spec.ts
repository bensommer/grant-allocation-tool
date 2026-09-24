import { expect, test } from '@playwright/test';

const stamp = () => Date.now().toString(36).toUpperCase().slice(-5);

test('duplicate program code is rejected with an inline error', async ({ page }) => {
  const code = `T${stamp()}`;
  await page.goto('/programs/new');
  await page.fill('input[name="code"]', code);
  await page.fill('input[name="name"]', 'Temp program');
  await page.getByRole('button', { name: 'Create program' }).click();
  await page.waitForURL(/\/programs\/[a-z0-9]+\?saved=1/);
  await expect(page.locator('.banner-ok')).toHaveText('Saved.');

  await page.goto('/programs/new');
  await page.fill('input[name="code"]', code.toLowerCase());
  await page.fill('input[name="name"]', 'Duplicate');
  await page.getByRole('button', { name: 'Create program' }).click();
  await page.waitForURL(/\/programs\/new\?f=/);
  await expect(page.locator('.field-error')).toHaveText(`Program code ${code} already exists`);
  await expect(page.locator('input[name="name"]')).toHaveValue('Duplicate');
});

test('create grant → add budget line → edit award → history shows before/after', async ({
  page,
}) => {
  const name = `E2E Grant ${stamp()}`;
  await page.goto('/grants/new');
  await page.fill('input[name="name"]', name);
  await page.fill('input[name="funderText"]', 'Test Funder');
  await page.fill('input[name="awardAmount"]', '10,000.00');
  await page.fill('input[name="startDate"]', '2026-01-01');
  await page.fill('input[name="endDate"]', '2026-12-31');
  await page.getByRole('button', { name: 'Create grant' }).click();
  await page.waitForURL(/\/grants\/[a-z0-9]+\?saved=1/);
  const url = page.url().split('?')[0]!;

  // validation: end before start
  await page.fill('input[name="endDate"]', '2025-12-31');
  await page.getByRole('button', { name: 'Save changes' }).click();
  await page.waitForURL(/\?f=/);
  await expect(page.locator('.field-error')).toContainText(
    'End date must be on or after start date',
  );

  // budget lines
  await page.goto(`${url}/budget`);
  await page.fill('#new-line input[name="code"]', 'pers');
  await page.fill('input[name="name"][form="new-line"]', 'Personnel');
  await page.fill('input[name="budget"][form="new-line"]', '6,000');
  await page.getByRole('button', { name: 'Add line' }).click();
  await page.waitForURL(/\/budget\?saved=1/);
  await expect(page.locator('tbody tr').first().locator('input[name="code"]')).toHaveValue('PERS');
  await expect(page.locator('tfoot')).toContainText('under award by 4,000.00');

  // edit award amount → audit event with before/after
  await page.goto(url);
  await page.fill('input[name="awardAmount"]', '12000');
  await page.getByRole('button', { name: 'Save changes' }).click();
  await page.waitForURL(/\?saved=1/);
  await page.goto(`${url}/history`);
  const row = page.locator('tbody tr').first();
  await expect(row).toContainText('awardAmountCents');
  await expect(row.locator('.line-through')).toHaveText('1000000');
  await expect(row.locator('.text-green-800')).toHaveText('1200000');

  // delete (no compute run references it) → back to list
  await page.goto(url);
  await page.getByRole('button', { name: 'Delete / archive' }).click();
  await page.waitForURL(/\/grants\?deleted=1/);
});
