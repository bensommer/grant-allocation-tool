import { describe, expect, it } from 'vitest';
import { toISODate } from '@/domain/dates';
import { accountExternalId, parseQboReport, parseReportDateRange, type Cell } from './parser';

/** A tiny "Transaction Detail by Account" export in the shape QuickBooks produces. */
function fixture(): Cell[][] {
  return [
    ['Example Org Inc.', '', '', '', '', '', ''],
    ['Transaction Detail by Account', '', '', '', '', '', ''],
    ['January 1-March 31, 2026', '', '', '', '', '', ''],
    ['', 'Transaction date', 'Transaction type', 'Num', 'Name', 'Description', 'Amount'],
    ['', 'Transaction date', 'Transaction type', 'Num', 'Name', 'Description', 'Amount'],
    ['Contributed income', '', '', '', '', '', ''],
    ['Grants', '', '', '', '', '', ''],
    ['', '01/15/2026', 'Deposit', '', 'Big Funder', 'Q1 grant', '10,000.00'],
    ['Total for Grants', '', '', '', '', '', '10000.00'],
    ['Total for Contributed income with sub-accounts', '', '', '', '', '', '10000.00'],
    ['Program Costs', '', '', '', '', '', ''],
    ['Supplies', '', '', '', '', '', ''],
    ['', '02/01/2026', 'Check', '1001', 'Store', 'Markers', '25.50'],
    ['', '02/01/2026', 'Check', '1001', 'Store', 'Markers', '25.50'],
    ['', '02/03/2026', 'Check', '1002', 'Store', 'Refund', '-5.50'],
    ['Total for Supplies', '', '', '', '', '', '45.50'],
    ['Total for Program Costs with sub-accounts', '', '', '', '', '', '45.50'],
    ['TOTAL', '', '', '', '', '', '10045.50'],
    ['', '', '', '', '', '', ''],
    ['Hand tally', '', '', '', '', '', '999.99'],
    ['', '03/03/2026', 'Check', '9999', 'Ignored', 'after TOTAL', '1.00'],
  ];
}

describe('parseQboReport', () => {
  it('reads title rows, the duplicated header, nested sections and stops at TOTAL', () => {
    const report = parseQboReport(fixture());
    expect(report.errors).toEqual([]);
    expect(report.companyName).toBe('Example Org Inc.');
    expect(report.title).toBe('Transaction Detail by Account');
    expect(toISODate(report.dateRange!.from)).toBe('2026-01-01');
    expect(toISODate(report.dateRange!.to)).toBe('2026-03-31');
    expect(report.headerRow).toBe(4);
    expect(report.columns).toMatchObject({ date: 1, type: 2, num: 3, name: 4, amount: 6 });
    expect(report.columns.class).toBeUndefined();
    expect(report.lines).toHaveLength(4); // the line after TOTAL is ignored
    expect(report.lines.map((l) => l.accountPath)).toEqual([
      ['Contributed income', 'Grants'],
      ['Program Costs', 'Supplies'],
      ['Program Costs', 'Supplies'],
      ['Program Costs', 'Supplies'],
    ]);
    expect(report.lines.map((l) => l.amountCents)).toEqual([1_000_000, 2550, 2550, -550]);
    expect(report.accounts.map((a) => accountExternalId(a.path))).toEqual([
      'Contributed income',
      'Contributed income:Grants',
      'Program Costs',
      'Program Costs:Supplies',
    ]);
  });

  it('records every "Total for" row and TOTAL as checksums', () => {
    const report = parseQboReport(fixture());
    expect(
      report.checksums.map((c) => [c.label, c.expectedCents, c.actualCents, c.passed]),
    ).toEqual([
      ['Total for Grants', 1_000_000, 1_000_000, true],
      ['Total for Contributed income with sub-accounts', 1_000_000, 1_000_000, true],
      ['Total for Supplies', 4550, 4550, true],
      ['Total for Program Costs with sub-accounts', 4550, 4550, true],
      ['TOTAL', 1_004_550, 1_004_550, true],
    ]);
  });

  it('flags a total that does not match the lines under it', () => {
    const rows = fixture();
    rows.splice(13, 1); // drop one of the duplicate 25.50 lines
    const report = parseQboReport(rows);
    const failed = report.checksums.filter((c) => !c.passed).map((c) => c.label);
    expect(failed).toEqual([
      'Total for Supplies',
      'Total for Program Costs with sub-accounts',
      'TOTAL',
    ]);
  });

  it('gives identical lines distinct external ids via the occurrence index, and shares matchKey without the amount', () => {
    const report = parseQboReport(fixture());
    const [, a, b, c] = report.lines;
    expect(a!.occurrenceIndex).toBe(0);
    expect(b!.occurrenceIndex).toBe(1);
    expect(a!.externalId).not.toBe(b!.externalId);
    expect(a!.matchKey).not.toBe(b!.matchKey);
    expect(a!.externalId).toMatch(/^[0-9a-f]{64}$/);
    // Same key except the amount → same matchKey, different externalId.
    const rows = fixture();
    rows[12]![6] = '26.50';
    rows[15]![6] = '46.50';
    rows[16]![6] = '46.50';
    rows[17]![6] = '10046.50';
    const edited = parseQboReport(rows);
    expect(edited.errors).toEqual([]);
    expect(edited.lines[1]!.matchKey).toBe(a!.matchKey);
    expect(edited.lines[1]!.externalId).not.toBe(a!.externalId);
    expect(c!.externalId).toBe(edited.lines[3]!.externalId);
  });

  it('reports a truncated export (no TOTAL) instead of importing silently', () => {
    const rows = fixture().slice(0, 16);
    const report = parseQboReport(rows);
    expect(report.errors.map((e) => e.code)).toContain('missing_grand_total');
  });

  it('detects columns by header text, including Class and Split when present', () => {
    const rows: Cell[][] = [
      ['Org', '', '', '', '', '', '', '', ''],
      ['Transaction Detail by Account', '', '', '', '', '', '', '', ''],
      ['January 1 - December 31, 2025', '', '', '', '', '', '', '', ''],
      [
        '',
        'Date',
        'Transaction Type',
        'Num',
        'Name',
        'Class',
        'Memo/Description',
        'Split',
        'Amount',
      ],
      ['Income', '', '', '', '', '', '', '', ''],
      ['', '2025-02-01', 'Deposit', '', 'Town', 'Programs:Youth', 'grant', 'Checking', '100.00'],
      ['Total for Income', '', '', '', '', '', '', '', '100.00'],
      ['TOTAL', '', '', '', '', '', '', '', '100.00'],
    ];
    const report = parseQboReport(rows);
    expect(report.errors).toEqual([]);
    expect(report.columns).toMatchObject({ class: 5, description: 6, split: 7, amount: 8 });
    expect(report.lines[0]).toMatchObject({
      className: 'Programs:Youth',
      split: 'Checking',
      accountPath: ['Income'],
    });
  });
});

describe('parseReportDateRange', () => {
  it.each([
    ['March 13-September 22, 2026', '2026-03-13', '2026-09-22'],
    ['January 1 - December 31, 2025', '2025-01-01', '2025-12-31'],
    ['January 1, 2025 - September 22, 2026', '2025-01-01', '2026-09-22'],
    ['01/01/2025 - 09/22/2026', '2025-01-01', '2026-09-22'],
  ])('%s', (text, from, to) => {
    const r = parseReportDateRange(text)!;
    expect(r).not.toBeNull();
    expect([toISODate(r.from), toISODate(r.to)]).toEqual([from, to]);
  });

  it('rejects text that is not a range', () => {
    expect(parseReportDateRange('All Dates')).toBeNull();
    expect(parseReportDateRange('September 22, 2026 - March 13, 2026')).toBeNull();
  });
});
