/**
 * Rollforward workbook (JPH-23) in the layout of the bookkeeper's "Restricted
 * Grants" tab: one column per fund plus a Total column, rows beginning /
 * received / released per class / ending, and a check row. Every derived cell
 * is a formula so the sheet recalculates in Excel or LibreOffice.
 */
import ExcelJS from 'exceljs';
import { toISODate } from '@/domain/dates';
import type { Rollforward } from '@/services/grant-periods';

const MONEY = '#,##0.00;(#,##0.00);"-"';

export const ROLLFORWARD_ROWS = [
  'Beginning restricted balance',
  'Received',
  'Released — direct expenses',
  'Released — staff costs',
  'Released — overhead',
  'Ending restricted balance',
] as const;

export async function rollforwardXlsx(
  rf: Rollforward,
  notes: Array<{ grant: string; text: string }> = [],
): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Restricted Grants');
  const funds = rf.rows;
  const firstCol = 2; // B
  const totalCol = firstCol + funds.length;
  const letter = (c: number) => ws.getColumn(c).letter;

  ws.getColumn(1).width = 34;
  for (let c = firstCol; c <= totalCol; c++) ws.getColumn(c).width = 18;

  ws.getCell(1, 1).value = 'Restricted grants rollforward';
  ws.getCell(1, 1).font = { bold: true, size: 14 };
  ws.getCell(2, 1).value = `Period ${toISODate(rf.from)} to ${toISODate(rf.to)}`;

  const header = 4;
  ws.getCell(header, 1).value = 'Fund';
  funds.forEach((f, i) => {
    ws.getCell(header, firstCol + i).value = f.name;
  });
  ws.getCell(header, totalCol).value = 'Total';
  ws.getRow(header).font = { bold: true };

  // Rows 5..10: beginning, received, direct, staff, overhead, ending.
  const rBegin = header + 1;
  const rRecv = rBegin + 1;
  const rDirect = rBegin + 2;
  const rStaff = rBegin + 3;
  const rOver = rBegin + 4;
  const rEnd = rBegin + 5;
  const rCheck = rEnd + 2;
  ROLLFORWARD_ROWS.forEach((label, i) => {
    ws.getCell(rBegin + i, 1).value = label;
  });
  ws.getCell(rCheck, 1).value = 'Check (should be 0.00)';

  funds.forEach((f, i) => {
    const c = firstCol + i;
    const L = letter(c);
    ws.getCell(rBegin, c).value = f.beginningCents / 100;
    ws.getCell(rRecv, c).value = f.receivedCents / 100;
    ws.getCell(rDirect, c).value = f.released.direct / 100;
    ws.getCell(rStaff, c).value = f.released.staff / 100;
    ws.getCell(rOver, c).value = f.released.overhead / 100;
    ws.getCell(rEnd, c).value = {
      formula: `${L}${rBegin}+${L}${rRecv}-SUM(${L}${rDirect}:${L}${rOver})`,
      result: f.endingCents / 100,
    };
  });
  const T = letter(totalCol);
  const F = letter(firstCol);
  const Lst = letter(totalCol - 1);
  for (const r of [rBegin, rRecv, rDirect, rStaff, rOver, rEnd]) {
    ws.getCell(r, totalCol).value = funds.length
      ? { formula: `SUM(${F}${r}:${Lst}${r})` }
      : 0;
  }
  ws.getCell(rEnd, totalCol).value = funds.length
    ? { formula: `SUM(${F}${rEnd}:${Lst}${rEnd})`, result: rf.totals.endingCents / 100 }
    : 0;
  ws.getCell(rCheck, totalCol).value = {
    formula: `ROUND(${T}${rBegin}+${T}${rRecv}-SUM(${T}${rDirect}:${T}${rOver})-${T}${rEnd},2)`,
    result: rf.totals.checkCents / 100,
  };

  for (const r of [rBegin, rRecv, rDirect, rStaff, rOver, rEnd, rCheck])
    for (let c = firstCol; c <= totalCol; c++) ws.getCell(r, c).numFmt = MONEY;
  ws.getRow(rEnd).font = { bold: true };
  ws.getRow(rEnd).border = { top: { style: 'thin' }, bottom: { style: 'double' } };
  ws.getColumn(totalCol).font = { bold: true };

  let r = rCheck + 2;
  if (notes.length) {
    ws.getCell(r, 1).value = 'Notes';
    ws.getCell(r, 1).font = { bold: true };
    for (const n of notes) {
      r++;
      ws.getCell(r, 1).value = n.grant;
      ws.getCell(r, 2).value = n.text;
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

/** Row indexes (1-based) used by the LibreOffice recalculation test. */
export const ROLLFORWARD_LAYOUT = { header: 4, beginning: 5, ending: 10, check: 12, firstCol: 2 };
