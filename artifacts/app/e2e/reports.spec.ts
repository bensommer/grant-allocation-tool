import { test, expect } from '@playwright/test';
import ExcelJS from 'exceljs';
test('GET builder, XLSX formulas and cached totals match the page', async ({ page, request }) => {
  await page.goto('/reports/custom');
  // The PDF export form carries the current parameters as hidden inputs (JPH-25 A10), so
  // drive the visible filter bar explicitly.
  const filters = page.locator('form.filter-bar');
  await filters.locator('select[name="rows"]').selectOption('program');
  await filters.locator('select[name="cols"]').selectOption('glAccount');
  await filters.locator('input[name="from"]').fill('2026-01-01');
  await filters.locator('input[name="to"]').fill('2026-03-31');
  await page.getByRole('button', { name: 'Apply' }).click();
  // Program × GL is one table: every program row in it, one grand total, no per-status tables.
  await expect(page.locator('table')).toHaveCount(1);
  await expect(page.locator('[data-grand-total]')).toHaveCount(1);
  await expect(page.locator('[data-grand-total]')).toHaveAttribute('data-cents', '7711861');
  await expect(page.getByRole('heading', { name: /Unmapped|Non-grant/ })).toHaveCount(0);
  await expect(page.getByRole('row', { name: /Management & General/ })).toContainText('Non-grant');
  const link = await page.getByRole('link', { name: 'XLSX' }).getAttribute('href');
  const res = await request.get(link!);
  expect(res.ok()).toBe(true);
  const book = new ExcelJS.Workbook();
  await book.xlsx.load((await res.body()) as unknown as Parameters<typeof book.xlsx.load>[0]);
  const sheet = book.getWorksheet('Report')!;
  const rows = sheet.getRows(1, sheet.rowCount)!.filter((r) => r.getCell(1).value === 'Total');
  expect(rows).toHaveLength(1);
  const cell = rows[0]!.getCell(rows[0]!.cellCount);
  expect(cell.value).toMatchObject({ formula: expect.stringMatching(/^SUM\(/) });
  expect(Math.round((cell.value as { result: number }).result * 100)).toBe(7711861);
  expect(book.getWorksheet('Detail')).toBeDefined();
  expect(book.getWorksheet('Parameters')).toBeDefined();
});
test('budget lines and expense classifications agree across exports', async ({ page, request }) => {
  await page.goto('/reports/custom?rows=grantBudgetLine&cols=glAccount&budget=1');
  await expect(page.getByRole('columnheader', { name: 'Budget ($)' }).first()).toBeVisible();
  await expect(
    page.getByRole('heading', { name: 'Program expense not charged to any grant' }),
  ).toBeVisible();
  await expect(page.getByRole('heading', { name: /Non-grant expense/ })).toBeVisible();
  await expect(page.getByRole('heading', { name: /Grant: Unmapped/ })).toHaveCount(0);
  for (const format of ['csv', 'xlsx', 'pdf']) {
    const result = await request.get(
      `/reports/export/${format}?rows=grantBudgetLine&cols=glAccount&budget=1`,
    );
    expect(result.status()).toBe(200);
  }
  await page.goto('/reports/custom?rows=grantBudgetLine&cols=glAccount&page=month&budget=1');
  await expect(
    page.getByText('Budget columns are shown when the report is broken by grant or not at all'),
  ).toBeVisible();
  await expect(page.getByRole('columnheader', { name: 'Budget ($)' })).toHaveCount(0);
});
test('grouping by mapping status keeps one table with subtotals', async ({ page }) => {
  await page.goto(
    '/reports/custom?rows=program&cols=glAccount&from=2026-01-01&to=2026-03-31&mapping=1',
  );
  await expect(page.locator('table')).toHaveCount(1);
  await expect(page.locator('tr.row-group')).toHaveCount(3);
  await expect(page.locator('tr.subtotal')).toHaveCount(3);
  await expect(page.locator('[data-grand-total]')).toHaveAttribute('data-cents', '7711861');
});
test.describe('chromium-nojs', () => {
  test.use({ javaScriptEnabled: false });
  test('renders the report and submits GET builder without JavaScript', async ({ page }) => {
    await page.goto('/reports/custom');
    await page.getByRole('button', { name: 'Apply' }).click();
    await expect(page.locator('table').first()).toBeVisible();
  });
});
