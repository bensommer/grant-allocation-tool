import { mkdtemp, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { CsvDataSource } from './adapter';
import { FULL_RANGE } from '@/datasource/import-service';

async function tmpBundle(transactions: string) {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'csv-'));
  await writeFile(
    path.join(dir, 'company.csv'),
    '\uFEFFname,fiscal_year_start_month,currency\r\nX,1,USD\r\n',
  );
  await writeFile(
    path.join(dir, 'accounts.csv'),
    'external_id,number,name,type,detail_type,parent_external_id,active\nA1,1000,Cash,Asset,,,true\nA6,6000,Exp,Expense,,,true\n',
  );
  await writeFile(path.join(dir, 'classes.csv'), 'external_id,name,parent_external_id,active\n');
  await writeFile(path.join(dir, 'locations.csv'), 'external_id,name,active\n');
  await writeFile(
    path.join(dir, 'parties.csv'),
    'external_id,kind,display_name,parent_external_id\n',
  );
  await writeFile(
    path.join(dir, 'transactions.csv'),
    'txn_external_id,txn_type,txn_date,doc_number,txn_memo,txn_party_external_id,payment_account_external_id,line_number,account_external_id,class_external_id,location_external_id,line_party_external_id,description,amount,posting_type\n' +
      transactions,
  );
  return dir;
}

describe('CsvDataSource', () => {
  it('handles BOM + CRLF and rejects an unbalanced JournalEntry', async () => {
    const dir = await tmpBundle(
      'JE1,JournalEntry,01/31/2026,,,,,1,A6,,,,x,"$1,000.00",debit\r\nJE1,JournalEntry,01/31/2026,,,,,2,A1,,,,x,"(999.50)",debit\r\n',
    );
    const ds = new CsvDataSource({ dir });
    const d = await ds.describe();
    expect(d.companyName).toBe('X');
    const txns = [];
    for await (const t of ds.fetchTransactions(FULL_RANGE)) txns.push(t);
    expect(txns).toHaveLength(0);
    expect(ds.errors.map((e) => e.code)).toEqual(['unbalanced_journal_entry']);
  });

  it('accepts a balanced JE using negative-amount credit encoding and MM/DD/YYYY dates', async () => {
    const dir = await tmpBundle(
      'JE1,JournalEntry,01/31/2026,,,,,1,A6,,,,x,"1,000.00",debit\nJE1,JournalEntry,01/31/2026,,,,,2,A1,,,,x,"(1,000.00)",debit\n',
    );
    const ds = new CsvDataSource({ dir });
    const txns = [];
    for await (const t of ds.fetchTransactions(FULL_RANGE)) txns.push(t);
    expect(ds.errors).toEqual([]);
    expect(txns).toHaveLength(1);
    expect(txns[0]!.txnDate.toISOString()).toBe('2026-01-31T00:00:00.000Z');
    expect(txns[0]!.lines[1]).toMatchObject({ amountCents: 100000, postingType: 'credit' });
  });

  it('reports a missing file', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'csv-'));
    const ds = new CsvDataSource({ dir });
    for await (const _ of ds.fetchAccounts()) void _;
    expect(ds.errors[0]).toMatchObject({ file: 'accounts.csv', code: 'missing_file' });
  });
});
