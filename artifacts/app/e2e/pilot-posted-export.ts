/**
 * The next QuickBooks export after the bookkeeper posts a drafted true-up: the tracked Opioid
 * pilot export plus one journal-entry row per grant-side CSV line, with every enclosing total
 * adjusted so the report still balances (the mirror image of `dropLine` in qbo-report.spec.ts).
 * Shared by the Phase D and Phase E pilot specs.
 */
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse as parseCsv } from 'csv-parse/sync';
import { expect } from '@playwright/test';
import { prisma } from '../src/lib/db';
import { readReportGrid } from '../src/datasource/qbo-report/read';
import type { Cell } from '../src/datasource/qbo-report/parser';

const here = path.dirname(fileURLToPath(import.meta.url));
const OPIOID_EXPORT = path.resolve(here, '../fixtures/pilot/opioid-export.csv');
/** Journal date inside the export's date range, so the posted row is in scope on re-import. */
export const POST_DATE = '09/22/2026';

type CsvRow = Record<string, string>;
const csvCents = (v: string | undefined) => (v ? Math.round(Number(v) * 100) : 0);
const amountCellToCents = (cell: Cell) =>
  Math.round(Number(String(cell ?? '').replace(/[,$\s]/g, '')) * 100);
const centsToAmountCell = (cents: number) => (cents / 100).toFixed(2);

export async function postedExport(grantName: string, csv: string): Promise<string> {
  const grant = await prisma.grant.findFirstOrThrow({ where: { name: grantName } });
  const parsed = parseCsv(csv, { columns: true }) as CsvRow[];
  const onGrant = parsed.filter(
    (r) =>
      (grant.qboClassName && r['Class'] === grant.qboClassName) ||
      (grant.qboProjectName && r['Name'] === grant.qboProjectName),
  );
  expect(onGrant.length).toBeGreaterThan(0);
  const grid = await readReportGrid(readFileSync(OPIOID_EXPORT), 'opioid-export.csv');
  const rows = grid.rows;
  const header = rows.find((r) => r.some((c) => String(c ?? '').trim() === 'Transaction date'))!;
  const cols: Record<string, number> = {};
  header.forEach((c, i) => {
    const t = String(c ?? '').trim();
    if (t) cols[t] = i;
  });
  for (const r of onGrant) {
    insertJournalLine(rows, cols, r['Account Name']!, {
      num: r['Journal No.']!,
      description: r['Journal/Description']!,
      cents: csvCents(r['Debits']) - csvCents(r['Credits']),
      className: r['Class'],
      name: r['Name'],
    });
  }
  const quote = (c: Cell) => {
    const s = String(c ?? '');
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const dir = mkdtempSync(path.join(os.tmpdir(), 'jph28-'));
  const file = path.join(dir, 'opioid-export.csv');
  writeFileSync(file, rows.map((r) => r.map(quote).join(',')).join('\n') + '\n');
  return file;
}

function insertJournalLine(
  rows: Cell[][],
  cols: Record<string, number>,
  accountName: string,
  line: { num: string; description: string; cents: number; className?: string; name?: string },
) {
  const amountCol = cols['Amount']!;
  const dateCol = cols['Transaction date']!;
  const totalIdx = rows.findIndex(
    (r) =>
      String(r[0] ?? '')
        .trim()
        .toLowerCase() === `total for ${accountName}`.toLowerCase(),
  );
  if (totalIdx < 0) throw new Error(`no "Total for ${accountName}" row`);
  const width = rows[totalIdx]!.length;
  const cells: Cell[] = Array.from({ length: width }, () => '');
  cells[dateCol] = POST_DATE;
  cells[cols['Transaction type']!] = 'Journal Entry';
  cells[cols['Num']!] = line.num;
  cells[cols['Description']!] = line.description;
  if (cols['Class full name'] !== undefined && line.className)
    cells[cols['Class full name']] = line.className;
  if (cols['Name'] !== undefined && line.name) cells[cols['Name']] = line.name;
  cells[amountCol] = centsToAmountCell(line.cents);
  rows.splice(totalIdx, 0, cells);
  const add = (row: Cell[]) => {
    row[amountCol] = centsToAmountCell(amountCellToCents(row[amountCol]) + line.cents);
  };
  let depth = 0;
  for (let i = totalIdx + 1; i < rows.length; i++) {
    const row = rows[i]!;
    const label = String(row[0] ?? '').trim();
    if (!label || /^\d{2}\/\d{2}\/\d{4}$/.test(String(row[dateCol] ?? ''))) continue;
    if (/^total$/i.test(label)) {
      add(row);
      break;
    }
    if (/^total for /i.test(label)) {
      if (depth > 0) depth--;
      else add(row);
    } else depth++;
  }
}
