import ExcelJS from 'exceljs';
import { centsToDecimalString } from '@/domain/money';
import { cellId, pivot } from './pivot';
import { dimensionLabels, type ReportParams } from './params';
import type { Fact } from './query';

export const pageKeys = (facts: Fact[], p: ReportParams) =>
  p.page ? [...new Set(facts.map((f) => f[p.page!]))].sort() : [undefined];
export function csvReport(facts: Fact[], p: ReportParams) {
  const quote = (v: string | number) => `"${String(v).replaceAll('"', '""')}"`;
  const rows = [[p.page ?? 'Page', p.rows, p.cols, 'Amount']];
  for (const pageKey of pageKeys(facts, p)) {
    const data = pivot(facts, { ...p, pageKey });
    for (const r of data.rowKeys)
      for (const c of data.colKeys)
        rows.push([pageKey ?? '', r, c, centsToDecimalString(data.cells.get(cellId(r, c)) ?? 0)]);
  }
  return rows.map((row) => row.map(quote).join(',')).join('\r\n') + '\r\n';
}
export async function xlsxReport(facts: Fact[], p: ReportParams, runId: string) {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('Report');
  sheet.columns = [{ width: 25 }, ...Array.from({ length: 40 }, () => ({ width: 18 }))];
  for (const pageKey of pageKeys(facts, p)) {
    const data = pivot(facts, { ...p, pageKey });
    if (pageKey !== undefined) {
      sheet.addRow([`${dimensionLabels[p.page!]}: ${pageKey}`]);
      sheet.lastRow!.font = { bold: true };
    }
    sheet.addRow([dimensionLabels[p.rows], ...data.colKeys, 'Total']);
    sheet.lastRow!.font = { bold: true };
    const first = sheet.rowCount + 1;
    for (const r of data.rowKeys) {
      const values: (string | number | { formula: string; result: number })[] = [
        r,
        ...data.colKeys.map((c) => (data.cells.get(cellId(r, c)) ?? 0) / 100),
      ];
      const idx = sheet.rowCount + 1;
      const lastCol = sheet.getColumn(data.colKeys.length + 1).letter;
      values.push({
        formula: `SUM(B${idx}:${lastCol}${idx})`,
        result: (data.rowTotals.get(r) ?? 0) / 100,
      });
      sheet.addRow(values);
    }
    const end = sheet.rowCount;
    const total = sheet.addRow(['Total']);
    for (let i = 2; i <= data.colKeys.length + 2; i++) {
      const col = sheet.getColumn(i).letter;
      total.getCell(i).value = {
        formula: `SUM(${col}${first}:${col}${end})`,
        result:
          i === data.colKeys.length + 2
            ? data.grandTotal / 100
            : (data.colTotals.get(data.colKeys[i - 2]!) ?? 0) / 100,
      };
    }
    total.font = { bold: true };
    for (let i = first; i <= sheet.rowCount; i++)
      for (let j = 2; j <= data.colKeys.length + 2; j++)
        sheet.getRow(i).getCell(j).numFmt = '#,##0.00;[Red](#,##0.00)';
    sheet.addRow([]);
  }
  const detail = workbook.addWorksheet('Detail');
  detail.addRow([
    'Date',
    'Doc',
    'Source line',
    'Program',
    'Grant',
    'Budget line',
    'GL account',
    'Status',
    'Amount',
  ]);
  detail.getRow(1).font = { bold: true };
  for (const f of facts)
    detail.addRow([
      f.date,
      f.doc,
      f.sourceLineId,
      f.program,
      f.grant,
      f.grantBudgetLine,
      f.glAccount,
      f.status,
      f.amountCents / 100,
    ]);
  detail.getColumn(9).numFmt = '#,##0.00';
  const params = workbook.addWorksheet('Parameters');
  for (const [key, value] of Object.entries({
    rows: p.rows,
    cols: p.cols,
    page: p.page ?? '',
    from: p.from ?? '',
    to: p.to ?? '',
    grant: p.grant.join(','),
    program: p.program.join(','),
    account: p.account.join(','),
    restricted: String(p.restricted),
    unmapped: String(p.unmapped),
    zeros: String(p.zeros),
    run: runId,
    generatedAt: new Date().toISOString(),
  }))
    params.addRow([key, value]);
  return workbook.xlsx.writeBuffer();
}
