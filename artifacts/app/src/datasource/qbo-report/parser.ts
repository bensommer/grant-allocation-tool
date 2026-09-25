import { createHash } from 'node:crypto';
import { parseDateInput, toISODate } from '@/domain/dates';
import { MoneyParseError, parseMoneyToCents } from '@/domain/money';
import type { ChecksumResult, ImportError } from '@/datasource/types';

/**
 * Parser for the QuickBooks Online "Transaction Detail by Account" report as
 * exported to Excel or CSV (JPH-20). Pure: takes a grid of cells, returns
 * lines, the account tree implied by the section headings, and one checksum
 * per "Total for …" / TOTAL row. It never touches the database.
 *
 * Layout handled (columns are found by header text, never by position):
 *   rows 1-3   company name, report title, date range (any order, blank rows ok)
 *   header     "Transaction date | Transaction type | Num | Name | [Class full name] |
 *              Description | [Split] | Amount" — may be repeated on the next row
 *   sections   a row with only a label in the first column opens an account
 *              section; nested sections open inside it
 *   lines      a row whose date column parses as a date
 *   totals     "Total for X" / "Total for X with sub-accounts" closes section X
 *   TOTAL      grand total; parsing stops here — anything after it is ignored
 * Columns to the right of the header are ignored (bookkeepers add tallies there).
 */

export type Cell = string | number | boolean | Date | null | undefined;

export type ColumnKey =
  'date' | 'type' | 'num' | 'name' | 'class' | 'description' | 'split' | 'amount';

const HEADER_ALIASES: Record<ColumnKey, string[]> = {
  date: ['transaction date', 'date'],
  type: ['transaction type', 'type'],
  num: ['num', 'num.', 'no.', 'number'],
  name: ['name'],
  class: ['class full name', 'class'],
  description: ['description', 'memo/description', 'memo'],
  split: ['split'],
  amount: ['amount'],
};
const REQUIRED_COLUMNS: ColumnKey[] = ['date', 'type', 'amount'];

export interface ReportLine {
  /** 1-based physical row in the export. */
  row: number;
  date: Date;
  txnType: string;
  num: string | null;
  name: string | null;
  className: string | null;
  description: string | null;
  split: string | null;
  /** Signed cents exactly as printed (expense debits positive, income credits positive). */
  amountCents: number;
  /** Section path from the top-level heading down to the account the line sits under. */
  accountPath: string[];
  /** 0-based index among lines with an identical (date|type|num|name|description|amount|account) key. */
  occurrenceIndex: number;
  /** sha256(date|type|num|name|description|amountCents|account|occurrenceIndex) */
  externalId: string;
  /** Same key without the amount, so an amount correction pairs with its old row. */
  matchKey: string;
}

export interface ReportAccount {
  path: string[];
  name: string;
  parentPath: string[] | null;
  /** Row where the section heading appeared. */
  row: number;
}

export interface ParsedReport {
  companyName: string | null;
  title: string | null;
  dateRangeText: string | null;
  dateRange: { from: Date; to: Date } | null;
  headerRow: number | null;
  columns: Partial<Record<ColumnKey, number>>;
  accounts: ReportAccount[];
  lines: ReportLine[];
  checksums: ChecksumResult[];
  errors: ImportError[];
}

export const ACCOUNT_PATH_SEPARATOR = ':';
export function accountExternalId(path: string[]): string {
  return path.join(ACCOUNT_PATH_SEPARATOR);
}

const normalize = (v: Cell): string => cellText(v).toLowerCase().replace(/\s+/g, ' ').trim();

export function cellText(v: Cell): string {
  if (v == null) return '';
  if (v instanceof Date) return toISODate(v);
  if (typeof v === 'object') {
    // exceljs rich text / formula results
    const o = v as { richText?: Array<{ text: string }>; result?: Cell; text?: string };
    if (Array.isArray(o.richText)) return o.richText.map((r) => r.text).join('');
    if (o.result !== undefined) return cellText(o.result);
    if (typeof o.text === 'string') return o.text;
  }
  return String(v).trim();
}

function cellDate(v: Cell): Date | null {
  if (v == null || v === '') return null;
  if (v instanceof Date) {
    if (Number.isNaN(v.getTime())) return null;
    // Excel dates come back as UTC midnight (or within hours of it when the
    // sheet carried a timezone); snap to the nearest day.
    return new Date(Math.round(v.getTime() / 86_400_000) * 86_400_000);
  }
  if (typeof v === 'number') {
    if (!Number.isFinite(v) || v < 20000 || v > 80000) return null;
    return new Date(Math.round(v - 25569) * 86_400_000);
  }
  const s = cellText(v);
  try {
    return parseDateInput(s);
  } catch {
    const iso = /^(\d{4}-\d{2}-\d{2})T/.exec(s);
    if (iso) {
      try {
        return parseDateInput(iso[1]!);
      } catch {
        return null;
      }
    }
    return null;
  }
}

function cellCents(v: Cell): number | null {
  if (v == null || v === '') return null;
  if (typeof v === 'number') {
    if (!Number.isFinite(v)) return null;
    return Math.round(v * 100);
  }
  if (typeof v === 'object' && !(v instanceof Date)) {
    const o = v as { result?: Cell };
    if (o.result !== undefined) return cellCents(o.result);
  }
  try {
    return parseMoneyToCents(cellText(v));
  } catch (e) {
    if (e instanceof MoneyParseError) return null;
    throw e;
  }
}

const MONTHS = [
  'january',
  'february',
  'march',
  'april',
  'may',
  'june',
  'july',
  'august',
  'september',
  'october',
  'november',
  'december',
];

/**
 * "March 13-September 22, 2026", "January 1, 2025 - December 31, 2025",
 * "03/13/2026-09/22/2026". Returns null for anything else (e.g. "All Dates").
 */
export function parseReportDateRange(text: string): { from: Date; to: Date } | null {
  const parts = text
    .trim()
    .split(/\s*[-–—]\s*|\s+to\s+/i)
    .map((p) => p.trim())
    .filter(Boolean);
  if (parts.length !== 2) return null;
  const word = (s: string) => {
    const m = /^([A-Za-z]+)\.?\s+(\d{1,2})(?:,?\s*(\d{4}))?$/.exec(s);
    if (!m) return null;
    const month = MONTHS.findIndex((name) => name.startsWith(m[1]!.toLowerCase().slice(0, 3)));
    if (month < 0 || m[1]!.length < 3) return null;
    return { month: month + 1, day: Number(m[2]), year: m[3] ? Number(m[3]) : null };
  };
  const left = word(parts[0]!);
  const right = word(parts[1]!);
  if (left && right) {
    const year = right.year ?? left.year;
    if (!year) return null;
    try {
      const from = parseDateInput(
        `${left.year ?? year}-${String(left.month).padStart(2, '0')}-${String(left.day).padStart(2, '0')}`,
      );
      const to = parseDateInput(
        `${year}-${String(right.month).padStart(2, '0')}-${String(right.day).padStart(2, '0')}`,
      );
      return from <= to ? { from, to } : null;
    } catch {
      return null;
    }
  }
  try {
    const from = parseDateInput(parts[0]!);
    const to = parseDateInput(parts[1]!);
    return from <= to ? { from, to } : null;
  } catch {
    return null;
  }
}

function detectHeader(row: Cell[]): Partial<Record<ColumnKey, number>> | null {
  const columns: Partial<Record<ColumnKey, number>> = {};
  row.forEach((cell, index) => {
    const text = normalize(cell);
    if (!text) return;
    for (const key of Object.keys(HEADER_ALIASES) as ColumnKey[]) {
      if (columns[key] === undefined && HEADER_ALIASES[key].includes(text)) {
        columns[key] = index;
        return;
      }
    }
  });
  return REQUIRED_COLUMNS.every((k) => columns[k] !== undefined) ? columns : null;
}

function sha(parts: Array<string | number>): string {
  return createHash('sha256').update(parts.join('|')).digest('hex');
}

export interface ParseOptions {
  /** Used in error rows. */
  fileName?: string;
}

export function parseQboReport(rows: Cell[][], opts: ParseOptions = {}): ParsedReport {
  const file = opts.fileName ?? 'report';
  const errors: ImportError[] = [];
  const fail = (row: number | null, column: string | null, code: string, message: string) =>
    errors.push({ file, row, column, code, message });

  const report: ParsedReport = {
    companyName: null,
    title: null,
    dateRangeText: null,
    dateRange: null,
    headerRow: null,
    columns: {},
    accounts: [],
    lines: [],
    checksums: [],
    errors,
  };

  // --- header -------------------------------------------------------------
  let headerIndex = -1;
  for (let i = 0; i < rows.length && i < 50; i++) {
    const columns = detectHeader(rows[i] ?? []);
    if (columns) {
      headerIndex = i;
      report.columns = columns;
      break;
    }
  }
  if (headerIndex < 0) {
    fail(
      null,
      null,
      'missing_header',
      'Could not find the report header row (needs at least "Transaction date", "Transaction type" and "Amount" columns).',
    );
    return report;
  }
  report.headerRow = headerIndex + 1;
  const columns = report.columns as Record<ColumnKey, number>;
  const mappedIndexes = new Set(Object.values(columns));
  const labelColumn = Math.min(...Object.values(columns)) > 0 ? 0 : columns.date;
  const rightmost = Math.max(...Object.values(columns));

  // --- title block ----------------------------------------------------------
  const titleTexts: string[] = [];
  for (let i = 0; i < headerIndex; i++) {
    const text = (rows[i] ?? []).map(cellText).find((t) => t !== '');
    if (text) titleTexts.push(text);
  }
  for (const text of titleTexts) {
    const range = parseReportDateRange(text);
    if (range && !report.dateRange) {
      report.dateRange = range;
      report.dateRangeText = text;
    } else if (/transaction detail|detail by account|report/i.test(text) && !report.title) {
      report.title = text;
    } else if (!report.companyName) {
      report.companyName = text;
    } else if (!report.title) {
      report.title = text;
    } else if (!report.dateRangeText) {
      report.dateRangeText = text;
    }
  }

  // --- body -----------------------------------------------------------------
  interface Section {
    name: string;
    path: string[];
    sumCents: number;
    row: number;
  }
  const stack: Section[] = [];
  const seenAccounts = new Set<string>();
  const fullKeyCounts = new Map<string, number>();
  const matchKeyCounts = new Map<string, number>();
  let grandCents = 0;
  let sawGrandTotal = false;

  const headerSignature = JSON.stringify((rows[headerIndex] ?? []).map(normalize));

  for (let i = headerIndex + 1; i < rows.length; i++) {
    const row = rows[i] ?? [];
    const rowNo = i + 1;
    if (JSON.stringify(row.map(normalize)) === headerSignature) continue; // repeated header
    const cells = row.slice(0, rightmost + 1);
    const nonEmpty = cells
      .map((c, index) => ({ index, text: cellText(c), raw: c }))
      .filter((c) => c.text !== '');
    if (nonEmpty.length === 0) continue;

    const dateCell = cells[columns.date];
    const date = cellDate(dateCell);
    const amountRaw = cells[columns.amount];
    const label = nonEmpty[0]!;
    const labelText = label.text.replace(/\s+/g, ' ').trim();
    const lower = labelText.toLowerCase();

    if (date) {
      // ---- data line
      const amountCents = cellCents(amountRaw);
      if (amountCents === null) {
        fail(
          rowNo,
          'Amount',
          'invalid_amount',
          `Row ${rowNo}: amount "${cellText(amountRaw)}" is not a number`,
        );
        continue;
      }
      if (stack.length === 0) {
        fail(
          rowNo,
          null,
          'line_outside_section',
          `Row ${rowNo}: transaction line appears before any account heading`,
        );
        continue;
      }
      const text = (key: ColumnKey): string | null => {
        const index = columns[key];
        if (index === undefined) return null;
        const t = cellText(cells[index]).replace(/\s+/g, ' ').trim();
        return t === '' ? null : t;
      };
      const txnType = text('type');
      if (!txnType) {
        fail(rowNo, 'Transaction type', 'missing_value', `Row ${rowNo}: transaction type is blank`);
        continue;
      }
      const accountPath = stack[stack.length - 1]!.path;
      const num = text('num');
      const name = text('name');
      const description = text('description');
      const account = accountExternalId(accountPath);
      const iso = toISODate(date);
      const fullKey = [
        iso,
        txnType,
        num ?? '',
        name ?? '',
        description ?? '',
        amountCents,
        account,
      ].join('|');
      const occurrenceIndex = fullKeyCounts.get(fullKey) ?? 0;
      fullKeyCounts.set(fullKey, occurrenceIndex + 1);
      const nearKey = [iso, txnType, num ?? '', name ?? '', description ?? '', account].join('|');
      const nearIndex = matchKeyCounts.get(nearKey) ?? 0;
      matchKeyCounts.set(nearKey, nearIndex + 1);
      report.lines.push({
        row: rowNo,
        date,
        txnType,
        num,
        name,
        className: text('class'),
        description,
        split: text('split'),
        amountCents,
        accountPath,
        occurrenceIndex,
        externalId: sha([
          iso,
          txnType,
          num ?? '',
          name ?? '',
          description ?? '',
          amountCents,
          account,
          occurrenceIndex,
        ]),
        matchKey: sha([iso, txnType, num ?? '', name ?? '', description ?? '', account, nearIndex]),
      });
      for (const s of stack) s.sumCents += amountCents;
      grandCents += amountCents;
      continue;
    }

    if (lower === 'total') {
      // ---- grand total: verify and stop
      const expected = cellCents(amountRaw);
      if (expected === null) {
        fail(
          rowNo,
          'Amount',
          'invalid_amount',
          `Row ${rowNo}: TOTAL amount "${cellText(amountRaw)}" is not a number`,
        );
      } else {
        report.checksums.push({
          row: rowNo,
          label: 'TOTAL',
          expectedCents: expected,
          actualCents: grandCents,
          passed: expected === grandCents,
        });
      }
      for (const open of stack) {
        fail(
          open.row,
          null,
          'unclosed_section',
          `Section "${open.name}" (row ${open.row}) has no "Total for" row before TOTAL`,
        );
      }
      stack.length = 0;
      sawGrandTotal = true;
      break;
    }

    const totalMatch = /^total for (.+?)(?: with sub-accounts)?$/i.exec(labelText);
    if (totalMatch) {
      // ---- section total: verify and close
      const name = totalMatch[1]!.trim();
      const expected = cellCents(amountRaw);
      let depth = -1;
      for (let d = stack.length - 1; d >= 0; d--) {
        if (stack[d]!.name.toLowerCase() === name.toLowerCase()) {
          depth = d;
          break;
        }
      }
      if (depth < 0) {
        fail(
          rowNo,
          null,
          'unmatched_total',
          `Row ${rowNo}: "${labelText}" has no open section named "${name}"`,
        );
        continue;
      }
      const section = stack[depth]!;
      for (let d = stack.length - 1; d > depth; d--) {
        const open = stack[d]!;
        fail(
          open.row,
          null,
          'unclosed_section',
          `Section "${open.name}" (row ${open.row}) was not closed before "${labelText}" (row ${rowNo})`,
        );
      }
      stack.length = depth;
      if (expected === null) {
        fail(
          rowNo,
          'Amount',
          'invalid_amount',
          `Row ${rowNo}: "${labelText}" amount "${cellText(amountRaw)}" is not a number`,
        );
        continue;
      }
      report.checksums.push({
        row: rowNo,
        label: labelText,
        expectedCents: expected,
        actualCents: section.sumCents,
        passed: expected === section.sumCents,
      });
      continue;
    }

    // ---- section heading: a lone label with nothing in the mapped columns
    const onlyLabel = nonEmpty.every((c) => c.index === label.index || !mappedIndexes.has(c.index));
    if (label.index === labelColumn && onlyLabel && cellCents(amountRaw) === null) {
      const path = [...(stack[stack.length - 1]?.path ?? []), labelText];
      const key = accountExternalId(path);
      if (!seenAccounts.has(key)) {
        seenAccounts.add(key);
        report.accounts.push({
          path,
          name: labelText,
          parentPath: path.length > 1 ? path.slice(0, -1) : null,
          row: rowNo,
        });
      }
      stack.push({ name: labelText, path, sumCents: 0, row: rowNo });
      continue;
    }
    // Anything else (notes, subtotals without dates, stray tallies) is ignored.
  }

  if (!sawGrandTotal) {
    fail(
      null,
      null,
      'missing_grand_total',
      'The export has no TOTAL row; the file looks truncated.',
    );
  }
  if (report.lines.length === 0 && errors.length === 0) {
    fail(null, null, 'no_lines', 'The report contains no transaction lines.');
  }
  return report;
}
