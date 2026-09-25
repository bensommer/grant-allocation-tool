import { createHash } from 'node:crypto';
import path from 'node:path';
import ExcelJS from 'exceljs';
import { parse as parseCsv } from 'csv-parse/sync';
import type { Cell } from '@/datasource/qbo-report/parser';

export interface ReportGrid {
  rows: Cell[][];
  sheetName: string | null;
  sha256: string;
}

export interface ReadReportOptions {
  /** Worksheet to read from an .xlsx workbook; defaults to the first sheet. */
  sheet?: string | null;
}

export function isXlsx(fileName: string): boolean {
  return /\.xlsx$/i.test(fileName);
}

/**
 * Turn an uploaded report export (.xlsx or .csv) into a plain cell grid for
 * the parser. Merged title cells in xlsx come back repeated in every merged
 * column; the parser only reads the first non-empty cell of a title row.
 */
export async function readReportGrid(
  content: Buffer,
  fileName: string,
  opts: ReadReportOptions = {},
): Promise<ReportGrid> {
  const sha256 = createHash('sha256').update(content).digest('hex');
  if (isXlsx(fileName)) {
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(content as unknown as ArrayBuffer);
    const sheet = opts.sheet
      ? workbook.worksheets.find(
          (w) => w.name.trim().toLowerCase() === opts.sheet!.trim().toLowerCase(),
        )
      : workbook.worksheets[0];
    if (!sheet) {
      const names = workbook.worksheets.map((w) => `"${w.name}"`).join(', ');
      throw new Error(`Worksheet "${opts.sheet}" not found. Available: ${names}`);
    }
    const rows: Cell[][] = [];
    sheet.eachRow({ includeEmpty: true }, (row, rowNumber) => {
      const values = row.values as Cell[]; // 1-based: index 0 is unused
      rows[rowNumber - 1] = values.slice(1).map((v) => v as Cell);
    });
    for (let i = 0; i < rows.length; i++) rows[i] ??= [];
    return { rows, sheetName: sheet.name, sha256 };
  }
  if (/\.(csv|txt)$/i.test(fileName) || !path.extname(fileName)) {
    const rows = parseCsv(content, {
      bom: true,
      relax_column_count: true,
      skip_empty_lines: false,
      trim: false,
    }) as string[][];
    return { rows, sheetName: null, sha256 };
  }
  throw new Error(
    `Unsupported file type "${path.extname(fileName)}"; upload the QuickBooks export as .xlsx or .csv`,
  );
}

export function listWorksheets(content: Buffer): Promise<string[]> {
  const workbook = new ExcelJS.Workbook();
  return workbook.xlsx
    .load(content as unknown as ArrayBuffer)
    .then(() => workbook.worksheets.map((w) => w.name));
}
