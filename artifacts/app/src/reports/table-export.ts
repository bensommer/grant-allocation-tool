/**
 * Generic export helpers for plain tables (BvA, restricted balances). The
 * crosstab report has its own richer exporter in ./export.ts.
 */
import ExcelJS from 'exceljs';

export type TableCell = string | number | null;

export interface ExportTable {
  title: string;
  /** key/value pairs written to the Parameters sheet */
  parameters: Record<string, string>;
  headers: string[];
  /** numeric cells are cents; they are written as currency in dollars */
  rows: TableCell[][];
  /** zero-based column indexes that get a SUM formula in the totals row */
  sumColumns?: number[];
}

export async function xlsxTable(table: ExportTable): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const sheet = wb.addWorksheet(table.title.slice(0, 31));
  sheet.columns = table.headers.map((h, i) => ({
    header: h,
    key: String(i),
    width: i === 0 ? 28 : 16,
  }));
  sheet.getRow(1).font = { bold: true };
  for (const r of table.rows) {
    sheet.addRow(r.map((c) => (typeof c === 'number' ? c / 100 : c)));
  }
  const first = 2;
  const last = sheet.rowCount;
  if (table.sumColumns?.length && last >= first) {
    const totals: (string | { formula: string })[] = table.headers.map(() => '');
    totals[0] = 'Total';
    for (const c of table.sumColumns) {
      const letter = sheet.getColumn(c + 1).letter;
      totals[c] = { formula: `SUM(${letter}${first}:${letter}${last})` };
    }
    sheet.addRow(totals).font = { bold: true };
  }
  for (const c of table.sumColumns ?? []) sheet.getColumn(c + 1).numFmt = '#,##0.00;(#,##0.00)';
  const params = wb.addWorksheet('Parameters');
  params.columns = [{ width: 22 }, { width: 60 }];
  for (const [k, v] of Object.entries(table.parameters)) params.addRow([k, v]);
  params.addRow(['Generated at', new Date().toISOString()]);
  return Buffer.from(await wb.xlsx.writeBuffer());
}

export function xlsxResponse(buf: Buffer, filename: string): Response {
  return new Response(new Uint8Array(buf), {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="${filename}"`,
    },
  });
}
