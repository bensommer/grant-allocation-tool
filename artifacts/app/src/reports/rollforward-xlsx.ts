/**
 * Rollforward workbook (JPH-23) mirroring the bookkeeper's "Restricted Grants" tab
 * cell for cell: funds across from column C, a Total column, then a Check column;
 * the beginning balance on row 8 (period start in A), Grants Received on row 10,
 * released classes as negatives on rows 11–13, and the ending balance on row 15 as
 * =SUM(rows 8:13). Every derived cell is a formula so the sheet recalculates in
 * Excel or LibreOffice.
 */
import ExcelJS from 'exceljs';
import { toISODate } from '@/domain/dates';
import type { Rollforward } from '@/services/grant-periods';

const MONEY = '#,##0.00;(#,##0.00);"-"';

/** Row labels in her tab's words; the app's names live on screen. */
export const ROLLFORWARD_ROWS = {
  beginning: 'Restricted Grant Balance',
  received: 'Grants Received',
  direct: 'Direct Expenses',
  staff: 'Staff Costs',
  overhead: 'Overhead',
  ending: 'Restricted Grant Balance',
} as const;

/** Cell positions (1-based) of her layout; the LibreOffice recalculation test reads these. */
export const ROLLFORWARD_LAYOUT = {
  title: 1,
  header: 7,
  beginning: 8,
  received: 10,
  direct: 11,
  staff: 12,
  overhead: 13,
  ending: 15,
  /** Rows that carry figures (the blanks at 9 and 14 are hers too). */
  valueRows: [8, 10, 11, 12, 13, 15],
  /** Column A holds the period start / "Current"; labels sit in B; funds start in C. */
  labelCol: 2,
  firstCol: 3,
} as const;

export async function rollforwardXlsx(
  rf: Rollforward,
  notes: Array<{ grant: string; text: string }> = [],
): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Restricted Grants');
  const funds = rf.rows;
  const L = ROLLFORWARD_LAYOUT;
  const totalCol = L.firstCol + funds.length;
  const checkCol = totalCol + 1;
  const letter = (c: number) => ws.getColumn(c).letter;

  ws.getColumn(1).width = 12;
  ws.getColumn(L.labelCol).width = 26;
  for (let c = L.firstCol; c <= checkCol; c++) ws.getColumn(c).width = 18;

  ws.getCell(L.title, 1).value = 'Restricted Net Assets Summary Schedule';
  ws.getCell(L.title, 1).font = { bold: true, size: 14 };
  ws.getCell(2, 1).value = `Period ${toISODate(rf.from)} to ${toISODate(rf.to)}`;

  funds.forEach((f, i) => {
    ws.getCell(L.header, L.firstCol + i).value = f.name;
  });
  ws.getCell(L.header, totalCol).value = 'Total';
  ws.getCell(L.header, checkCol).value = 'Check';
  ws.getRow(L.header).font = { bold: true };
  ws.getRow(L.header).alignment = { wrapText: true, vertical: 'bottom' };

  ws.getCell(L.beginning, 1).value = rf.from;
  ws.getCell(L.beginning, 1).numFmt = 'm/d/yyyy';
  ws.getCell(L.beginning, L.labelCol).value = ROLLFORWARD_ROWS.beginning;
  ws.getCell(L.received, L.labelCol).value = ROLLFORWARD_ROWS.received;
  ws.getCell(L.direct, L.labelCol).value = ROLLFORWARD_ROWS.direct;
  ws.getCell(L.staff, L.labelCol).value = ROLLFORWARD_ROWS.staff;
  ws.getCell(L.overhead, L.labelCol).value = ROLLFORWARD_ROWS.overhead;
  ws.getCell(L.ending, 1).value = 'Current';
  ws.getCell(L.ending, L.labelCol).value = ROLLFORWARD_ROWS.ending;

  funds.forEach((f, i) => {
    const c = L.firstCol + i;
    const col = letter(c);
    ws.getCell(L.beginning, c).value = f.beginningCents / 100;
    ws.getCell(L.received, c).value = f.receivedCents / 100;
    // Released amounts are negative in her tab so the ending balance is a plain SUM.
    ws.getCell(L.direct, c).value = -f.released.direct / 100;
    ws.getCell(L.staff, c).value = -f.released.staff / 100;
    ws.getCell(L.overhead, c).value = -f.released.overhead / 100;
    ws.getCell(L.ending, c).value = {
      formula: `SUM(${col}${L.beginning}:${col}${L.overhead})`,
      result: f.endingCents / 100,
    };
  });
  const T = letter(totalCol);
  const F = letter(L.firstCol);
  const last = letter(Math.max(L.firstCol, totalCol - 1));
  for (const r of L.valueRows) {
    ws.getCell(r, totalCol).value = funds.length ? { formula: `SUM(${F}${r}:${last}${r})` } : 0;
  }
  ws.getCell(L.ending, totalCol).value = funds.length
    ? { formula: `SUM(${F}${L.ending}:${last}${L.ending})`, result: rf.totals.endingCents / 100 }
    : 0;
  ws.getCell(L.ending, checkCol).value = {
    formula: `ROUND(SUM(${T}${L.beginning}:${T}${L.overhead})-${T}${L.ending},2)`,
    result: rf.totals.checkCents / 100,
  };

  for (const r of L.valueRows)
    for (let c = L.firstCol; c <= checkCol; c++) ws.getCell(r, c).numFmt = MONEY;
  ws.getRow(L.ending).font = { bold: true };
  ws.getRow(L.ending).border = { top: { style: 'thin' }, bottom: { style: 'double' } };
  ws.getColumn(totalCol).font = { bold: true };

  let r = L.ending + 2;
  if (notes.length) {
    ws.getCell(r, 1).value = 'Notes';
    ws.getCell(r, 1).font = { bold: true };
    for (const n of notes) {
      r++;
      ws.getCell(r, 1).value = n.grant;
      ws.getCell(r, L.firstCol).value = n.text;
    }
  }

  const params = wb.addWorksheet('Parameters');
  params.columns = [{ width: 22 }, { width: 60 }];
  params.addRow(['From', toISODate(rf.from)]);
  params.addRow(['To', toISODate(rf.to)]);
  params.addRow(['Compute run', rf.runId ?? 'none']);
  params.addRow(['Generated at', new Date().toISOString()]);
  return Buffer.from(await wb.xlsx.writeBuffer());
}
