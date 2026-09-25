import { z } from 'zod';

/**
 * DataSource abstraction. Adapters (CSV today, QuickBooks Online later) emit
 * validated DTOs; ImportService persists them and knows nothing about the
 * adapter's origin.
 */

export const accountTypeSchema = z.enum([
  'Income',
  'Expense',
  'Asset',
  'Liability',
  'Equity',
  'COGS',
  'OtherExpense',
  'OtherIncome',
]);
export type AccountTypeDto = z.infer<typeof accountTypeSchema>;

export const partyKindSchema = z.enum(['customer', 'project', 'vendor', 'employee']);
export const txnTypeSchema = z.enum([
  'Bill',
  'Expense',
  'Check',
  'JournalEntry',
  'Deposit',
  'Invoice',
  'SalesReceipt',
  'Payroll',
  'CreditCardCredit',
  'VendorCredit',
]);
export const postingTypeSchema = z.enum(['debit', 'credit']);

export const sourceDescriptorSchema = z.object({
  companyName: z.string().min(1),
  fiscalYearStartMonth: z.number().int().min(1).max(12),
  currency: z.string().length(3),
});
export type SourceDescriptor = z.infer<typeof sourceDescriptorSchema>;

export const sourceAccountSchema = z.object({
  externalId: z.string().min(1),
  number: z.string().nullable(),
  name: z.string().min(1),
  type: accountTypeSchema,
  detailType: z.string().nullable(),
  parentExternalId: z.string().nullable(),
  active: z.boolean(),
});
export type SourceAccount = z.infer<typeof sourceAccountSchema>;

export const sourceClassSchema = z.object({
  externalId: z.string().min(1),
  name: z.string().min(1),
  parentExternalId: z.string().nullable(),
  active: z.boolean(),
});
export type SourceClass = z.infer<typeof sourceClassSchema>;

export const sourceLocationSchema = z.object({
  externalId: z.string().min(1),
  name: z.string().min(1),
  active: z.boolean(),
});
export type SourceLocation = z.infer<typeof sourceLocationSchema>;

export const sourcePartySchema = z.object({
  externalId: z.string().min(1),
  kind: partyKindSchema,
  displayName: z.string().min(1),
  parentExternalId: z.string().nullable(),
});
export type SourceParty = z.infer<typeof sourcePartySchema>;

export const sourceTransactionLineSchema = z.object({
  lineNumber: z.number().int().min(1),
  accountExternalId: z.string().min(1),
  classExternalId: z.string().nullable(),
  locationExternalId: z.string().nullable(),
  partyExternalId: z.string().nullable(),
  description: z.string().nullable(),
  /** Unsigned magnitude in cents; side given by postingType. */
  amountCents: z.number().int().min(0),
  postingType: postingTypeSchema,
});
export type SourceTransactionLine = z.infer<typeof sourceTransactionLineSchema>;

export const sourceTransactionSchema = z.object({
  externalId: z.string().min(1),
  /**
   * Optional secondary key without the amount. When a scoped re-import finds
   * one vanished row and one new row sharing a matchKey, the ImportService
   * records a change (amount edited in QuickBooks) instead of removed + new.
   */
  matchKey: z.string().min(1).nullable().optional(),
  txnType: txnTypeSchema,
  /** UTC midnight */
  txnDate: z.date(),
  docNumber: z.string().nullable(),
  memo: z.string().nullable(),
  partyExternalId: z.string().nullable(),
  paymentAccountExternalId: z.string().nullable(),
  lines: z.array(sourceTransactionLineSchema).min(1),
});
export type SourceTransaction = z.infer<typeof sourceTransactionSchema>;

export interface DateRange {
  from: Date;
  to: Date;
}

export type SourceKind = 'csv' | 'qbo' | 'qbo_report';

export interface DataSource {
  kind: SourceKind;
  /** Optional: file name used in error rows (defaults to transactions.csv). */
  fileName?: string;
  describe(): Promise<SourceDescriptor>;
  fetchAccounts(): AsyncIterable<SourceAccount>;
  fetchClasses(): AsyncIterable<SourceClass>;
  fetchLocations(): AsyncIterable<SourceLocation>;
  fetchParties(): AsyncIterable<SourceParty>;
  fetchTransactions(range: DateRange): AsyncIterable<SourceTransaction>;
  /** Optional: adapters that read files report content hashes for the batch record. */
  fileHashes?(): Promise<Record<string, string>>;
  /**
   * Optional: report-style sources verify every "Total for …" row against the
   * lines under it. Any failed checksum aborts the batch before anything is written.
   */
  checksums?(): ChecksumResult[];
  /** Optional source-reported expense balances at a reporting period end. */
  fetchTrialBalance?(): Promise<SourceTrialBalance[]>;
  /** Incremental CDC hook; QBO implementation is deferred to JPH-14. */
  syncChanges?(since: Date): Promise<SourceChange[]>;
  /**
   * Optional: adapters that can only report rows changed since a cursor
   * (QBO Change Data Capture) implement this; CSV returns undefined so the
   * ImportService treats the file set as the full truth for the range.
   */
  changedSince?(cursor: string): AsyncIterable<SourceChange>;
}

/** One "Total for X" / TOTAL row of a report export compared with the lines it covers. */
export interface ChecksumResult {
  /** 1-based physical row of the total line in the export. */
  row: number;
  /** Text of the total row, e.g. "Total for Program Supplies". */
  label: string;
  expectedCents: number;
  actualCents: number;
  passed: boolean;
}

export interface SourceTrialBalance {
  accountExternalId: string;
  periodEnd: string;
  balanceCents: number;
}

export type SourceChange =
  | { entity: 'account'; op: 'upsert'; row: SourceAccount }
  | { entity: 'account'; op: 'delete'; externalId: string }
  | { entity: 'transaction'; op: 'upsert'; row: SourceTransaction }
  | { entity: 'transaction'; op: 'delete'; externalId: string };

/** Structured, non-fatal error collected during adapter parsing or import validation. */
export interface ImportError {
  file: string;
  row: number | null;
  column: string | null;
  code: string;
  message: string;
}

export class DataSourceError extends Error {
  constructor(public readonly errors: ImportError[]) {
    super(`${errors.length} import error(s)`);
    this.name = 'DataSourceError';
  }
}

/** Adapters attach an error sink so they can collect instead of failing fast. */
export interface ErrorSink {
  push(error: ImportError): void;
}
