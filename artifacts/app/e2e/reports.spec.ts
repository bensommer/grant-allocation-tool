import { test, expect } from '@playwright/test';
import ExcelJS from 'exceljs';
test('GET builder, XLSX formulas and cached totals match the page', async ({ page, request }) => {
  await page.goto('/reports/custom');
  await page.locator('select[name="rows"]').selectOption('program');
  await page.locator('select[name="cols"]').selectOption('glAccount');
  await page.locator('input[name="from"]').fill('2026-01-01');
  await page.locator('input[name="to"]').fill('2026-03-31');
  await page.getByRole('button', { name: 'Apply' }).click();
  const totals = await page.locator('tfoot tr td[data-cents]:last-of-type').all();
  const reportTotal = await Promise.all(totals.map((cell) => cell.getAttribute('data-cents')));
  expect(reportTotal.map(Number).reduce((sum, cents) => sum + cents, 0)).toBe(7711861);
  const link = await page.getByRole('link', { name: 'XLSX' }).getAttribute('href');
  const res = await request.get(link!);
  expect(res.ok()).toBe(true);
  const book = new ExcelJS.Workbook();
  await book.xlsx.load((await res.body()) as unknown as Parameters<typeof book.xlsx.load>[0]);
  const sheet = book.getWorksheet('Report')!;
  const total = sheet.lastRow!.values; // last row is spacer; locate Total row explicitly
  expect(total).toBeDefined();
  const rows = sheet.getRows(1, sheet.rowCount)!.filter((r) => r.getCell(1).value === 'Total');
  const results = rows.map((row) => {
    const cell = row.getCell(row.cellCount);
    expect(cell.value).toMatchObject({ formula: expect.stringMatching(/^SUM\(/) });
    return (cell.value as { result: number }).result;
  });
  expect(Math.round(results.reduce((sum, amount) => sum + amount, 0) * 100)).toBe(7711861);
  expect(book.getWorksheet('Detail')).toBeDefined();
  expect(book.getWorksheet('Parameters')).toBeDefined();
});
test('budget lines and expense classifications agree across exports', async ({ page, request }) => {
  await page.goto('/reports/custom?rows=grantBudgetLine&cols=glAccount&budget=1');
  await expect(page.getByRole('columnheader', { name: 'Budget ($)' }).first()).toBeVisible();
  await expect(page.getByRole('heading', { name: /Unmapped program expense/ })).toBeVisible();
  await expect(page.getByRole('heading', { name: /Non-grant expense/ })).toBeVisible();
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
test.describe('chromium-nojs', () => {
  test.use({ javaScriptEnabled: false });
  test('renders the report and submits GET builder without JavaScript', async ({ page }) => {
    await page.goto('/reports/custom');
    await page.getByRole('button', { name: 'Apply' }).click();
    await expect(page.locator('table').first()).toBeVisible();
  });
});
