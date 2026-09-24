import { test, expect } from '@playwright/test';
import ExcelJS from 'exceljs';
test('GET builder, XLSX formulas and cached totals match the page', async ({ page, request }) => {
  await page.goto('/reports/custom');
  await page.locator('select[name="rows"]').selectOption('program');
  await page.locator('select[name="cols"]').selectOption('glAccount');
  await page.locator('input[name="from"]').fill('2026-01-01');
  await page.locator('input[name="to"]').fill('2026-03-31');
  await page.getByRole('button', { name: 'Build report' }).click();
  await expect(page.locator('tfoot')).toContainText('77,118.61');
  const link = await page.getByRole('link', { name: 'Download XLSX' }).getAttribute('href');
  const res = await request.get(link!);
  expect(res.ok()).toBe(true);
  const book = new ExcelJS.Workbook();
  await book.xlsx.load((await res.body()) as unknown as Parameters<typeof book.xlsx.load>[0]);
  const sheet = book.getWorksheet('Report')!;
  const total = sheet.lastRow!.values; // last row is spacer; locate Total row explicitly
  expect(total).toBeDefined();
  const row = sheet.getRows(1, sheet.rowCount)!.find((r) => r.getCell(1).value === 'Total')!;
  const cell = row.getCell(row.cellCount);
  expect(cell.value).toMatchObject({ formula: expect.stringMatching(/^SUM\(/), result: 77118.61 });
  expect(book.getWorksheet('Detail')).toBeDefined();
  expect(book.getWorksheet('Parameters')).toBeDefined();
});
test.describe('chromium-nojs', () => {
  test.use({ javaScriptEnabled: false });
  test('renders the report and submits GET builder without JavaScript', async ({ page }) => {
    await page.goto('/reports/custom');
    await page.getByRole('button', { name: 'Build report' }).click();
    await expect(page.locator('table').first()).toBeVisible();
  });
});
