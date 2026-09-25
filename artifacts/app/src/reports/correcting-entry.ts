/**
 * Correcting-entry exports (JPH-22). Read-only: a human posts the entry in
 * QuickBooks and re-imports; nothing here talks to QuickBooks.
 *
 * CSV layout follows Intuit's "Import journal entries into QuickBooks Online"
 * template (checked 2026-09-25):
 * https://quickbooks.intuit.com/learn-support/en-us/help-article/import-export-data-files/import-journal-entries-quickbooks-online/L4tQBwbs7_US_en_US
 * Required columns: Journal No., Journal Date, Account Name, Debits, Credits;
 * optional: Journal/Description, Name, Class, Location (the importer maps
 * columns by header, so the optional ones may be left blank). One row per
 * line; every row repeats the journal number and date. Dates are MM/DD/YYYY.
 */
import { centsToDecimalString } from '@/domain/money';
import type { ExportTable } from './table-export';

export interface EntryExportLine {
  lineNumber: number;
  accountName: string;
  className: string | null;
  partyName: string | null;
  grantSide: boolean;
  debitCents: number;
  creditCents: number;
  description: string;
}

export interface EntryExport {
  code: string;
  kind: 'reclass' | 'true_up';
  status: 'drafted' | 'posted' | 'void';
  date: Date;
  memo: string;
  grantName: string;
  lines: EntryExportLine[];
}

export const QBO_JE_HEADERS = [
  'Journal No.',
  'Journal Date',
  'Account Name',
  'Journal/Description',
  'Debits',
  'Credits',
  'Name',
  'Class',
  'Location',
] as const;

function usDate(d: Date): string {
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(d.getUTCDate()).padStart(2, '0');
  return `${mm}/${dd}/${d.getUTCFullYear()}`;
}

const csvCell = (x: string | number | null) =>
  `"${String(x ?? '').replaceAll('"', '""')}"`;

export function entryCsvRows(e: EntryExport): (string | number | null)[][] {
  return e.lines.map((l) => [
    e.code,
    usDate(e.date),
    l.accountName,
    l.description,
    l.debitCents ? centsToDecimalString(l.debitCents) : '',
    l.creditCents ? centsToDecimalString(l.creditCents) : '',
    l.partyName ?? '',
    l.className ?? '',
    '',
  ]);
}

export function entryCsv(e: EntryExport): string {
  const rows = [[...QBO_JE_HEADERS], ...entryCsvRows(e)];
  return rows.map((r) => r.map(csvCell).join(',')).join('\r\n') + '\r\n';
}

export function entryTable(e: EntryExport): ExportTable & { totals: (string | number | null)[] } {
  const debit = e.lines.reduce((s, l) => s + l.debitCents, 0);
  const credit = e.lines.reduce((s, l) => s + l.creditCents, 0);
  return {
    title: `Correcting entry ${e.code}`,
    parameters: {
      Grant: e.grantName,
      Kind: e.kind === 'reclass' ? 'Reclass' : 'True-up',
      Status: e.status,
      'Journal date': usDate(e.date),
      Memo: e.memo,
    },
    headers: ['#', 'Account', 'Class', 'Name', 'Side', 'Description', 'Debit', 'Credit'],
    rows: e.lines.map((l) => [
      l.lineNumber,
      l.accountName,
      l.className ?? '',
      l.partyName ?? '',
      l.grantSide ? 'grant' : 'destination',
      l.description,
      l.debitCents || null,
      l.creditCents || null,
    ]),
    totals: ['', 'Total', '', '', '', '', debit, credit],
  };
}
