import { toISODate } from '@/domain/dates';
import {
  type AccountTypeDto,
  type ChecksumResult,
  type DataSource,
  type DateRange,
  type ImportError,
  type SourceAccount,
  type SourceClass,
  type SourceDescriptor,
  type SourceLocation,
  type SourceParty,
  type SourceTransaction,
  txnTypeSchema,
  sourceTransactionSchema,
  accountTypeSchema,
} from '@/datasource/types';
import {
  ACCOUNT_PATH_SEPARATOR,
  accountExternalId,
  type ParsedReport,
  type ReportAccount,
} from '@/datasource/qbo-report/parser';

/**
 * DataSource over a parsed "Transaction Detail by Account" export (JPH-20).
 *
 * External ids are derived from the report text (there are no QuickBooks ids
 * in a report export):
 *   account  → the section path, "Cost of Programs and Events:Programs:Program Supplies"
 *   class    → "class:" + class full name
 *   party    → "party:" + Name column
 *   txn      → sha256(date|type|num|name|description|amountCents|account|occurrenceIndex)
 * Every line becomes a one-line transaction; the Split column names the bank/card
 * side, which the report does not list as an account, so it stays informational.
 */

export const TXN_TYPE_ALIASES: Record<string, SourceTransaction['txnType']> = {
  bill: 'Bill',
  expense: 'Expense',
  check: 'Check',
  cheque: 'Check',
  'journal entry': 'JournalEntry',
  journal: 'JournalEntry',
  deposit: 'Deposit',
  invoice: 'Invoice',
  'sales receipt': 'SalesReceipt',
  payroll: 'Payroll',
  'payroll check': 'Payroll',
  paycheck: 'Payroll',
  'credit card credit': 'CreditCardCredit',
  'vendor credit': 'VendorCredit',
  'bill payment (check)': 'Check',
  'bill payment (credit card)': 'Expense',
  'credit card expense': 'Expense',
  'credit card charge': 'Expense',
  'cash expense': 'Expense',
};

export function mapTxnType(raw: string): SourceTransaction['txnType'] | null {
  const direct = txnTypeSchema.safeParse(raw.replace(/\s+/g, ''));
  if (direct.success) return direct.data;
  return TXN_TYPE_ALIASES[raw.trim().toLowerCase().replace(/\s+/g, ' ')] ?? null;
}

/**
 * Report exports do not carry account types. The top-level heading tells us
 * enough for the pilot ("Contributed income" vs. cost sections); the confirm
 * page lets the bookkeeper correct any guess before anything is written.
 */
export function inferAccountType(topLevel: string): AccountTypeDto {
  const t = topLevel.toLowerCase();
  if (/\b(income|revenue|contributions?|grants? received|support)\b/.test(t)) return 'Income';
  if (/\bother income\b/.test(t)) return 'OtherIncome';
  if (/\bcost of goods\b|\bcogs\b/.test(t)) return 'COGS';
  if (/\bother expense/.test(t)) return 'OtherExpense';
  return 'Expense';
}

export const ACCOUNT_TYPE_FIELD_PREFIX = 'accountType:';

/** Confirm-page form fields "accountType:<externalId>" → override map. */
export function accountTypeOverrides(
  entries: Iterable<[string, unknown]>,
): Record<string, AccountTypeDto> {
  const overrides: Record<string, AccountTypeDto> = {};
  for (const [key, value] of entries) {
    if (!key.startsWith(ACCOUNT_TYPE_FIELD_PREFIX)) continue;
    const parsed = accountTypeSchema.safeParse(String(value));
    if (parsed.success) overrides[key.slice(ACCOUNT_TYPE_FIELD_PREFIX.length)] = parsed.data;
  }
  return overrides;
}

export interface AccountMappingRow {
  externalId: string;
  name: string;
  path: string[];
  inferredType: AccountTypeDto;
  type: AccountTypeDto;
  lineCount: number;
}

/** Account list for the confirm page: every heading plus its inferred/overridden type. */
export function accountMapping(
  report: ParsedReport,
  overrides: Record<string, AccountTypeDto> = {},
): AccountMappingRow[] {
  const counts = new Map<string, number>();
  for (const line of report.lines) {
    const key = accountExternalId(line.accountPath);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const typeFor = (account: ReportAccount): AccountTypeDto => {
    // Walk up to the nearest overridden ancestor, else infer from the top level.
    for (let depth = account.path.length; depth >= 1; depth--) {
      const key = accountExternalId(account.path.slice(0, depth));
      if (overrides[key]) return overrides[key]!;
    }
    return inferAccountType(account.path[0]!);
  };
  return report.accounts.map((a) => {
    const externalId = accountExternalId(a.path);
    return {
      externalId,
      name: a.name,
      path: a.path,
      inferredType: inferAccountType(a.path[0]!),
      type: typeFor(a),
      lineCount: counts.get(externalId) ?? 0,
    };
  });
}

export interface QboReportDataSourceOptions {
  report: ParsedReport;
  fileName: string;
  sha256: string;
  /** Org settings are preserved: a report import never renames the org. */
  org: SourceDescriptor;
  accountTypes?: Record<string, AccountTypeDto>;
}

export class QboReportDataSource implements DataSource {
  readonly kind = 'qbo_report' as const;
  readonly fileName: string;
  readonly errors: ImportError[];
  readonly reportMeta: Record<string, string | null>;
  private readonly report: ParsedReport;
  private readonly sha256: string;
  private readonly org: SourceDescriptor;
  private readonly mapping: AccountMappingRow[];
  private readonly typeByAccount: Map<string, AccountTypeDto>;

  constructor(opts: QboReportDataSourceOptions) {
    this.report = opts.report;
    this.fileName = opts.fileName;
    this.sha256 = opts.sha256;
    this.org = opts.org;
    this.errors = [...opts.report.errors];
    this.mapping = accountMapping(opts.report, opts.accountTypes ?? {});
    this.typeByAccount = new Map(this.mapping.map((m) => [m.externalId, m.type]));
    this.reportMeta = {
      companyName: opts.report.companyName,
      title: opts.report.title,
      dateRangeText: opts.report.dateRangeText,
      fileName: opts.fileName,
    };
  }

  checksums(): ChecksumResult[] {
    return this.report.checksums;
  }

  async fileHashes(): Promise<Record<string, string>> {
    return { [this.fileName]: this.sha256 };
  }

  async describe(): Promise<SourceDescriptor> {
    return this.org;
  }

  async *fetchAccounts(): AsyncIterable<SourceAccount> {
    for (const m of this.mapping) {
      yield {
        externalId: m.externalId,
        number: null,
        name: m.name,
        type: m.type,
        detailType: null,
        parentExternalId: m.path.length > 1 ? accountExternalId(m.path.slice(0, -1)) : null,
        active: true,
      };
    }
  }

  async *fetchClasses(): AsyncIterable<SourceClass> {
    const seen = new Set<string>();
    for (const line of this.report.lines) {
      if (!line.className) continue;
      const segments = line.className.split(ACCOUNT_PATH_SEPARATOR).map((s) => s.trim());
      for (let depth = 1; depth <= segments.length; depth++) {
        const full = segments.slice(0, depth).join(ACCOUNT_PATH_SEPARATOR);
        if (seen.has(full)) continue;
        seen.add(full);
        yield {
          externalId: `class:${full}`,
          name: segments[depth - 1]!,
          parentExternalId:
            depth > 1 ? `class:${segments.slice(0, depth - 1).join(ACCOUNT_PATH_SEPARATOR)}` : null,
          active: true,
        };
      }
    }
  }

  async *fetchLocations(): AsyncIterable<SourceLocation> {
    // Report exports carry no location column.
  }

  async *fetchParties(): AsyncIterable<SourceParty> {
    const kinds = new Map<string, SourceParty['kind']>();
    for (const line of this.report.lines) {
      if (!line.name) continue;
      const type = this.typeByAccount.get(accountExternalId(line.accountPath)) ?? 'Expense';
      const kind: SourceParty['kind'] =
        type === 'Income' || type === 'OtherIncome' ? 'customer' : 'vendor';
      const current = kinds.get(line.name);
      // A name seen on any expense line is a vendor; income-only names are customers.
      if (!current || (current === 'customer' && kind === 'vendor')) kinds.set(line.name, kind);
    }
    for (const [name, kind] of kinds) {
      yield { externalId: `party:${name}`, kind, displayName: name, parentExternalId: null };
    }
  }

  async *fetchTransactions(range: DateRange): AsyncIterable<SourceTransaction> {
    for (const line of this.report.lines) {
      if (line.date < range.from || line.date > range.to) continue;
      const txnType = mapTxnType(line.txnType);
      if (!txnType) {
        this.errors.push({
          file: this.fileName,
          row: line.row,
          column: 'Transaction type',
          code: 'unknown_txn_type',
          message: `Row ${line.row}: transaction type "${line.txnType}" is not supported`,
        });
        continue;
      }
      const account = accountExternalId(line.accountPath);
      const type = this.typeByAccount.get(account) ?? 'Expense';
      const creditNormal =
        type === 'Income' || type === 'OtherIncome' || type === 'Liability' || type === 'Equity';
      // Report amounts are printed in the account's natural sign.
      const postingType: 'debit' | 'credit' =
        line.amountCents >= 0 === !creditNormal ? 'debit' : 'credit';
      const dto: SourceTransaction = {
        externalId: line.externalId,
        matchKey: line.matchKey,
        txnType,
        txnDate: line.date,
        docNumber: line.num,
        memo: line.description,
        partyExternalId: line.name ? `party:${line.name}` : null,
        paymentAccountExternalId: null,
        lines: [
          {
            lineNumber: 1,
            accountExternalId: account,
            classExternalId: line.className ? `class:${line.className}` : null,
            locationExternalId: null,
            partyExternalId: null,
            description: line.description,
            amountCents: Math.abs(line.amountCents),
            postingType,
          },
        ],
      };
      const parsed = sourceTransactionSchema.safeParse(dto);
      if (!parsed.success) {
        for (const issue of parsed.error.issues) {
          this.errors.push({
            file: this.fileName,
            row: line.row,
            column: String(issue.path[0] ?? ''),
            code: 'invalid_value',
            message: `Row ${line.row} (${toISODate(line.date)}): ${issue.message}`,
          });
        }
        continue;
      }
      yield parsed.data;
    }
  }
}
