import { expect, test } from '@playwright/test';
import { readFileSync } from 'node:fs';

const expected = JSON.parse(
  readFileSync(new URL('../fixtures/demo/expected.json', import.meta.url), 'utf8'),
) as {
  expenseByProgramGl: Record<string, Record<string, number>>;
};

test('six matrix cells match fixture cents', async ({ page }) => {
  await page.goto('/crosswalk/matrix');
  const checks = [
    ['6010', 'CT'],
    ['6010', 'YM'],
    ['6010', 'MG'],
    ['6020', 'FR'],
    ['6210', 'YM'],
    ['6220', 'CT'],
  ] as const;
  const headings = await page.locator('main thead th').allTextContents();
  for (const [account, program] of checks) {
    const column = headings.findIndex((h) => h.includes(program));
    expect(column, `program ${program}`).toBeGreaterThan(0);
    const row = page
      .locator('main tbody tr')
      .filter({ has: page.getByRole('rowheader', { name: new RegExp(account) }) });
    await expect(
      row
        .locator('td')
        .nth(column - 1)
        .locator('[data-cents]'),
    ).toHaveAttribute('data-cents', String(expected.expenseByProgramGl[account]![program]));
    console.log(
      `MATRIX ${account} × ${program}: ${expected.expenseByProgramGl[account]![program]} cents`,
    );
  }
});

test('overview and restricted balances use the current run', async ({ page }) => {
  await page.goto('/reports/overview');
  await expect(page.getByLabel('As of')).toHaveValue('2026-03-31');
  await expect(page.getByRole('heading', { name: 'Flagged grants' })).toBeVisible();
  await expect(
    page
      .locator('.card')
      .filter({ has: page.getByRole('heading', { name: 'Flagged grants' }) })
      .getByText('2', { exact: true }),
  ).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Unmapped program expense' })).toBeVisible();
  await expect(
    page
      .locator('.card')
      .filter({ has: page.getByRole('heading', { name: 'Unmapped program expense' }) })
      .locator('[data-cents="216000"]')
      .first(),
  ).toBeVisible();
  await expect(page.getByText(/Over pace:/)).toHaveCount(2);
  await page.goto('/restricted?asOf=2026-03-31');
  await expect(page.getByRole('row', { name: /Culinary Workforce Grant/ })).toContainText(
    '20,247.09',
  );
  await expect(page.getByRole('row', { name: /Youth Meals Grant/ })).toContainText('3,618.80');
  await expect(page.getByText('Rivera general operating gift')).toHaveCount(0);
});
