import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { parse } from 'csv-parse';
import { z } from 'zod';
import { parseDateInput } from '@/domain/dates';
import { parseMoneyToCents } from '@/domain/money';
import {
  accountTypeSchema,
  type DataSource,
  type DateRange,
  type ErrorSink,
  type ImportError,
  partyKindSchema,
  type SourceAccount,
  type SourceClass,
  type SourceDescriptor,
  type SourceLocation,
  type SourceParty,
  type SourceTransaction,
  type SourceTransactionLine,
  sourceAccountSchema,
  sourceClassSchema,
  sourceDescriptorSchema,
  sourceLocationSchema,
  sourcePartySchema,
  sourceTransactionSchema,
  txnTypeSchema,
  postingTypeSchema,
} from '@/datasource/types';

export const CSV_FILES = [
  'company.csv',
  'accounts.csv',
  'classes.csv',
  'locations.csv',
  'parties.csv',
  'transactions.csv',
] as const;
export type CsvFileName = (typeof CSV_FILES)[number];

const REQUIRED_HEADERS: Record<CsvFileName, string[]> = {
  'company.csv': ['name', 'fiscal_year_start_month', 'currency'],
  'accounts.csv': [
    'external_id',
    'number',
    'name',
    'type',
    'detail_type',
    'parent_external_id',
    'active',
  ],
  'classes.csv': ['external_id', 'name', 'parent_external_id', 'active'],
  'locations.csv': ['external_id', 'name', 'active'],
  'parties.csv': ['external_id', 'kind', 'display_name', 'parent_external_id'],
  'transactions.csv': [
    'txn_external_id',
    'txn_type',
    'txn_date',
    'doc_number',
    'txn_memo',
    'txn_party_external_id',
    'payment_account_external_id',
    'line_number',
    'account_external_id',
    'class_external_id',
    'location_external_id',
    'line_party_external_id',
    'description',
    'amount',
    'posting_type',
  ],
};

type Row = Record<string, string>;
interface NumberedRow {
  /** 1-based physical line number in the file, header = 1. */
  row: number;
  data: Row;
}

function opt(v: string | undefined): string | null {
  const s = (v ?? '').trim();
  return s === '' ? null : s;
}

function parseBool(v: string | undefined): boolean {
  const s = (v ?? '').trim().toLowerCase();
  return s === '' || s === 'true' || s === '1' || s === 'yes' || s === 'y';
}

export interface CsvDataSourceOptions {
  dir: string;
  /** Optional additional sink (e.g. CLI progress output). */
  errors?: ErrorSink;
}

/**
 * CSV adapter. Reads the six-file bundle defined in story 04. Parsing errors are
 * pushed to the error sink; rows that fail are skipped so the caller can show
 * a complete report. The ImportService aborts the batch if any error was
 * recorded.
 */
export class CsvDataSource implements DataSource {
  readonly kind = 'csv' as const;
  private readonly dir: string;
  private readonly sink: ErrorSink;
  /** Every error collected while reading; ImportService aborts the batch if non-empty. */
  readonly errors: ImportError[] = [];

  constructor(opts: CsvDataSourceOptions) {
    this.dir = opts.dir;
    const external = opts.errors;
    this.sink = {
      push: (e) => {
        this.errors.push(e);
        external?.push(e);
      },
    };
  }

  private async *rows(file: CsvFileName): AsyncGenerator<NumberedRow> {
    const full = path.join(this.dir, file);
    try {
      await stat(full);
    } catch {
      this.sink.push({
        file,
        row: null,
        column: null,
        code: 'missing_file',
        message: `${file} not found`,
      });
      return;
    }
    const parser = createReadStream(full).pipe(
      parse({
        bom: true,
        columns: (header: string[]) => header.map((h) => h.trim()),
        skip_empty_lines: true,
        relax_column_count: true,
        trim: false,
        info: true,
      }),
    );
    let headerChecked = false;
    for await (const record of parser as AsyncIterable<{ record: Row; info: { lines: number } }>) {
      if (!headerChecked) {
        headerChecked = true;
        const missing = REQUIRED_HEADERS[file].filter((h) => !(h in record.record));
        if (missing.length > 0) {
          this.sink.push({
            file,
            row: 1,
            column: missing.join(','),
            code: 'missing_columns',
            message: `Missing required column(s): ${missing.join(', ')}`,
          });
          return;
        }
      }
      yield { row: record.info.lines, data: record.record };
    }
  }

  private fail(
    file: string,
    row: number,
    column: string | null,
    code: string,
    message: string,
  ): void {
    this.sink.push({ file, row, column, code, message });
  }

  private validate<T>(schema: z.ZodType<T>, value: unknown, file: string, row: number): T | null {
    const r = schema.safeParse(value);
    if (r.success) return r.data;
    for (const issue of r.error.issues) {
      this.fail(file, row, String(issue.path[0] ?? ''), 'invalid_value', issue.message);
    }
    return null;
  }

  async describe(): Promise<SourceDescriptor> {
    for await (const { row, data } of this.rows('company.csv')) {
      const parsed = this.validate(
        sourceDescriptorSchema,
        {
          companyName: data['name']?.trim(),
          fiscalYearStartMonth: Number(data['fiscal_year_start_month']),
          currency: data['currency']?.trim(),
        },
        'company.csv',
        row,
      );
      if (parsed) return parsed;
    }
    this.fail('company.csv', 2, null, 'missing_row', 'company.csv must contain one data row');
    return { companyName: 'Unknown', fiscalYearStartMonth: 1, currency: 'USD' };
  }

  async *fetchAccounts(): AsyncIterable<SourceAccount> {
    const seen = new Set<string>();
    for await (const { row, data } of this.rows('accounts.csv')) {
      const type = accountTypeSchema.safeParse(data['type']?.trim());
      if (!type.success) {
        this.fail(
          'accounts.csv',
          row,
          'type',
          'invalid_account_type',
          `Unknown account type "${data['type']}"`,
        );
        continue;
      }
      const dto = this.validate(
        sourceAccountSchema,
        {
          externalId: data['external_id']?.trim(),
          number: opt(data['number']),
          name: data['name']?.trim(),
          type: type.data,
          detailType: opt(data['detail_type']),
          parentExternalId: opt(data['parent_external_id']),
          active: parseBool(data['active']),
        },
        'accounts.csv',
        row,
      );
      if (!dto) continue;
      if (seen.has(dto.externalId)) {
        this.fail(
          'accounts.csv',
          row,
          'external_id',
          'duplicate_external_id',
          `Duplicate external_id ${dto.externalId}`,
        );
        continue;
      }
      seen.add(dto.externalId);
      yield dto;
    }
  }

  async *fetchClasses(): AsyncIterable<SourceClass> {
    const seen = new Set<string>();
    for await (const { row, data } of this.rows('classes.csv')) {
      const dto = this.validate(
        sourceClassSchema,
        {
          externalId: data['external_id']?.trim(),
          name: data['name']?.trim(),
          parentExternalId: opt(data['parent_external_id']),
          active: parseBool(data['active']),
        },
        'classes.csv',
        row,
      );
      if (!dto) continue;
      if (seen.has(dto.externalId)) {
        this.fail(
          'classes.csv',
          row,
          'external_id',
          'duplicate_external_id',
          `Duplicate external_id ${dto.externalId}`,
        );
        continue;
      }
      seen.add(dto.externalId);
      yield dto;
    }
  }

  async *fetchLocations(): AsyncIterable<SourceLocation> {
    const seen = new Set<string>();
    for await (const { row, data } of this.rows('locations.csv')) {
      const dto = this.validate(
        sourceLocationSchema,
        {
          externalId: data['external_id']?.trim(),
          name: data['name']?.trim(),
          active: parseBool(data['active']),
        },
        'locations.csv',
        row,
      );
      if (!dto) continue;
      if (seen.has(dto.externalId)) {
        this.fail(
          'locations.csv',
          row,
          'external_id',
          'duplicate_external_id',
          `Duplicate external_id ${dto.externalId}`,
        );
        continue;
      }
      seen.add(dto.externalId);
      yield dto;
    }
  }

  async *fetchParties(): AsyncIterable<SourceParty> {
    const seen = new Set<string>();
    for await (const { row, data } of this.rows('parties.csv')) {
      const kind = partyKindSchema.safeParse(data['kind']?.trim());
      if (!kind.success) {
        this.fail(
          'parties.csv',
          row,
          'kind',
          'invalid_party_kind',
          `Unknown party kind "${data['kind']}"`,
        );
        continue;
      }
      const dto = this.validate(
        sourcePartySchema,
        {
          externalId: data['external_id']?.trim(),
          kind: kind.data,
          displayName: data['display_name']?.trim(),
          parentExternalId: opt(data['parent_external_id']),
        },
        'parties.csv',
        row,
      );
      if (!dto) continue;
      if (seen.has(dto.externalId)) {
        this.fail(
          'parties.csv',
          row,
          'external_id',
          'duplicate_external_id',
          `Duplicate external_id ${dto.externalId}`,
        );
        continue;
      }
      seen.add(dto.externalId);
      yield dto;
    }
  }

  /**
   * transactions.csv has one row per line with header fields repeated. Rows for
   * a transaction are grouped by txn_external_id (rows need not be contiguous).
   * A transaction with any bad row is emitted with the good rows only if no
   * row-level error occurred; otherwise it is dropped (the batch will abort anyway).
   */
  async *fetchTransactions(range: DateRange): AsyncIterable<SourceTransaction> {
    const file = 'transactions.csv';
    interface Pending {
      firstRow: number;
      header: Omit<SourceTransaction, 'lines'>;
      lines: SourceTransactionLine[];
      broken: boolean;
    }
    const pending = new Map<string, Pending>();
    const order: string[] = [];

    for await (const { row, data } of this.rows(file)) {
      const txnId = (data['txn_external_id'] ?? '').trim();
      if (txnId === '') {
        this.fail(file, row, 'txn_external_id', 'missing_value', 'txn_external_id is required');
        continue;
      }
      let p = pending.get(txnId);
      if (!p) {
        let ok = true;
        const txnType = txnTypeSchema.safeParse(data['txn_type']?.trim());
        if (!txnType.success) {
          this.fail(
            file,
            row,
            'txn_type',
            'invalid_txn_type',
            `Unknown txn_type "${data['txn_type']}"`,
          );
          ok = false;
        }
        let txnDate = new Date(0);
        try {
          txnDate = parseDateInput(data['txn_date'] ?? '');
        } catch {
          this.fail(
            file,
            row,
            'txn_date',
            'invalid_date',
            `Invalid txn_date "${data['txn_date']}"`,
          );
          ok = false;
        }
        p = {
          firstRow: row,
          header: {
            externalId: txnId,
            txnType: txnType.success ? txnType.data : 'JournalEntry',
            txnDate,
            docNumber: opt(data['doc_number']),
            memo: opt(data['txn_memo']),
            partyExternalId: opt(data['txn_party_external_id']),
            paymentAccountExternalId: opt(data['payment_account_external_id']),
          },
          lines: [],
          broken: !ok,
        };
        pending.set(txnId, p);
        order.push(txnId);
      }

      let lineOk = true;
      const lineNumber = Number(data['line_number']);
      if (!Number.isInteger(lineNumber) || lineNumber < 1) {
        this.fail(
          file,
          row,
          'line_number',
          'invalid_value',
          `Invalid line_number "${data['line_number']}"`,
        );
        lineOk = false;
      }
      let amountCents = 0;
      try {
        amountCents = parseMoneyToCents(data['amount'] ?? '');
      } catch {
        this.fail(file, row, 'amount', 'invalid_amount', `Malformed amount "${data['amount']}"`);
        lineOk = false;
      }
      const posting = postingTypeSchema.safeParse(
        (data['posting_type'] ?? '').trim().toLowerCase(),
      );
      if (!posting.success) {
        this.fail(
          file,
          row,
          'posting_type',
          'invalid_value',
          `posting_type must be debit or credit`,
        );
        lineOk = false;
      }
      const accountExternalId = (data['account_external_id'] ?? '').trim();
      if (accountExternalId === '') {
        this.fail(
          file,
          row,
          'account_external_id',
          'missing_value',
          'account_external_id is required',
        );
        lineOk = false;
      }
      if (!lineOk) {
        p.broken = true;
        continue;
      }
      // Negative amount flips the side (QBO exports sometimes encode credits that way).
      let side = posting.success ? posting.data : 'debit';
      if (amountCents < 0) {
        amountCents = -amountCents;
        side = side === 'debit' ? 'credit' : 'debit';
      }
      p.lines.push({
        lineNumber,
        accountExternalId,
        classExternalId: opt(data['class_external_id']),
        locationExternalId: opt(data['location_external_id']),
        partyExternalId: opt(data['line_party_external_id']),
        description: opt(data['description']),
        amountCents,
        postingType: side,
      });
    }

    for (const id of order) {
      const p = pending.get(id)!;
      if (p.broken) continue;
      if (p.header.txnType === 'JournalEntry') {
        const debits = p.lines
          .filter((l) => l.postingType === 'debit')
          .reduce((a, l) => a + l.amountCents, 0);
        const credits = p.lines
          .filter((l) => l.postingType === 'credit')
          .reduce((a, l) => a + l.amountCents, 0);
        if (debits !== credits) {
          this.fail(
            file,
            p.firstRow,
            'amount',
            'unbalanced_journal_entry',
            `JournalEntry ${id} is unbalanced: debits ${debits} ≠ credits ${credits} (cents)`,
          );
          continue;
        }
      }
      const lineNumbers = new Set<number>();
      let dup = false;
      for (const l of p.lines) {
        if (lineNumbers.has(l.lineNumber)) {
          this.fail(
            file,
            p.firstRow,
            'line_number',
            'duplicate_line_number',
            `Duplicate line_number ${l.lineNumber} in ${id}`,
          );
          dup = true;
        }
        lineNumbers.add(l.lineNumber);
      }
      if (dup) continue;
      if (p.header.txnDate < range.from || p.header.txnDate > range.to) continue;
      const dto = this.validate(
        sourceTransactionSchema,
        { ...p.header, lines: p.lines },
        file,
        p.firstRow,
      );
      if (dto) yield dto;
    }
  }

  async fileHashes(): Promise<Record<string, string>> {
    const out: Record<string, string> = {};
    for (const f of CSV_FILES) {
      try {
        const buf = await readFile(path.join(this.dir, f));
        out[f] = createHash('sha256').update(buf).digest('hex');
      } catch {
        // missing file reported elsewhere
      }
    }
    return out;
  }
}

export function collectErrors(): { sink: ErrorSink; errors: ImportError[] } {
  const errors: ImportError[] = [];
  return { sink: { push: (e) => errors.push(e) }, errors };
}
