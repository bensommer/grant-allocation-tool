import { expect, test } from '@playwright/test';
import { prisma } from '../src/lib/db';

test.afterEach(async () => {
  await prisma.allocationRule.deleteMany({ where: { name: { startsWith: 'Allocation E2E ' } } });
});

test('invalid 60/50 split retains values, then fixed 50/50 saves', async ({ page }) => {
  await page.goto('/allocation/new');
  await page.getByRole('button', { name: 'Add target' }).click();
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

async function createRuleWithParty(page: import('@playwright/test').Page, name: string) {
  await page.goto('/allocation/new');
  await page.fill('input[name="name"]', name);
  await page.locator('input[name="accountIds"]').first().check();
  const employees = page.locator('details.party-group').filter({ hasText: 'Employees' });
  await employees.locator('summary').click();
  const party = employees.locator('input[name="partyIds"]').first();
  const partyId = await party.getAttribute('value');
  await party.check();
  const program = await page
    .locator('select[name="program_0"] option:not([value=""])')
    .first()
    .getAttribute('value');
  await page.selectOption('select[name="program_0"]', program!);
  await page.fill('input[name="share_0"]', '100');
  await page.getByRole('button', { name: 'Create rule' }).click();
  await page.waitForURL(/\/allocation\/[a-z0-9]+\?saved=1/);
  return partyId!;
}

test('party groups persist the selected party and summarise the count', async ({ page }) => {
  const name = `Allocation E2E parties ${Date.now()}`;
  const partyId = await createRuleWithParty(page, name);
  const rule = await prisma.allocationRule.findFirstOrThrow({ where: { name } });
  expect((rule.matchers as { partyIds?: string[] }).partyIds).toEqual([partyId]);
  await page.reload();
  const employees = page.locator('details.party-group').filter({ hasText: 'Employees' });
  await expect(employees).toHaveAttribute('open', '');
  await expect(employees.locator('summary')).toContainText('1 selected');
  await expect(employees.locator(`input[value="${partyId}"]`)).toBeChecked();
  await expect(
    page.locator('details.party-group').filter({ hasText: 'Vendors' }).locator('summary'),
  ).toContainText('0 selected');
});

test.describe('JavaScript disabled', () => {
  test.use({ javaScriptEnabled: false });

  test('party checkboxes submit without JavaScript', async ({ page }) => {
    const name = `Allocation E2E nojs parties ${Date.now()}`;
    const partyId = await createRuleWithParty(page, name);
    const rule = await prisma.allocationRule.findFirstOrThrow({ where: { name } });
    expect((rule.matchers as { partyIds?: string[] }).partyIds).toEqual([partyId]);
  });

  test('GET editor controls keep unsaved form fields', async ({ page }) => {
    await page.goto('/allocation/new');
    await page.getByRole('textbox', { name: 'Rule name' }).fill('Unsaved allocation draft');
    const account = page.locator('input[name="accountIds"]').first();
    const selectedAccount = await account.getAttribute('value');
    await account.check();
    const selectedClass = await page
      .locator('input[name="classIds"]')
      .first()
      .getAttribute('value');
    await page.locator('input[name="classIds"]').first().check();
    const selectedProgram = await page
      .locator('select[name="program_0"] option:not([value=""])')
      .first()
      .getAttribute('value');
    await page.getByLabel('Program 1').selectOption(selectedProgram!);
    await page.getByRole('textbox', { name: 'Share 1' }).fill('40');
    await page.getByLabel('Effective from').fill('2026-01-01');
    await page.getByRole('button', { name: 'Add target' }).click();
    await expect(page.getByRole('textbox', { name: 'Rule name' })).toHaveValue(
      'Unsaved allocation draft',
    );
    await expect(
      page.locator(`input[name="accountIds"][value="${selectedAccount}"]`),
    ).toBeChecked();
    await expect(page.locator(`input[name="classIds"][value="${selectedClass}"]`)).toBeChecked();
    await expect(page.getByRole('textbox', { name: 'Share 1' })).toHaveValue('40');
    await expect(page.getByLabel('Program 1')).toHaveValue(selectedProgram!);
    await expect(page.getByLabel('Effective from')).toHaveValue('2026-01-01');
    await expect(page.getByRole('textbox', { name: 'Share 2' })).toBeVisible();

    await page.getByLabel('Split method').selectOption('ratio_of_driver');
    await page.getByRole('button', { name: 'Change method' }).click();
    await expect(page.getByRole('textbox', { name: 'Rule name' })).toHaveValue(
      'Unsaved allocation draft',
    );
    await expect(
      page.locator(`input[name="accountIds"][value="${selectedAccount}"]`),
    ).toBeChecked();
    await expect(page.locator(`input[name="classIds"][value="${selectedClass}"]`)).toBeChecked();
    await expect(page.getByLabel('Effective from')).toHaveValue('2026-01-01');
    await expect(page.getByLabel('Driver key')).toBeVisible();
    await expect(page.getByLabel('Program 1')).toHaveValue(selectedProgram!);
    await expect(page.getByRole('textbox', { name: 'Share 1' })).toHaveCount(0);

    await page.getByLabel('Split method').selectOption('fixed_pct');
    await page.getByRole('button', { name: 'Change method' }).click();
    await expect(page.getByRole('textbox', { name: 'Share 1' })).toHaveValue('40');
    await expect(page.getByLabel('Program 1')).toHaveValue(selectedProgram!);
    await expect(page.getByRole('textbox', { name: 'Rule name' })).toHaveValue(
      'Unsaved allocation draft',
    );
  });
});
