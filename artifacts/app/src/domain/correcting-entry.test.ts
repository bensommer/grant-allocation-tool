import { describe, expect, it } from 'vitest';
import {
  GrantCodingMissingError,
  UnbalancedEntryError,
  assertBalanced,
  buildReclassLines,
  buildTrueUpLines,
  carriesCode,
  grantSideCents,
  type EntryLineDraft,
} from './correcting-entry';

const GRANT = { classId: 'cls-grant', partyId: null, className: 'Trauma Grants', partyName: null };
const DEST = { classId: 'cls-admin', partyId: null, className: 'Admin', partyName: null };
const line = (debitCents: number, creditCents: number, grantSide = false): EntryLineDraft => ({
  accountId: 'acct',
  classId: null,
  partyId: null,
  className: null,
  partyName: null,
  grantSide,
  debitCents,
  creditCents,
  description: 'x',
});

describe('correcting entries (JPH-22)', () => {
  it('AC8: an unbalanced entry is rejected at the domain level', () => {
    expect(() => assertBalanced([line(100, 0), line(0, 99)])).toThrow(UnbalancedEntryError);
    expect(() => assertBalanced([line(100, 0), line(0, 99)])).toThrow(/1\.00 ≠ credits 0\.99/);
    expect(() => assertBalanced([line(100, 0)])).toThrow(/at least two lines/);
    expect(() => assertBalanced([line(100, 100), line(0, 0)])).toThrow(/either a debit or a credit/);
    expect(() => assertBalanced([line(-100, 0), line(0, -100)])).toThrow(/cannot be negative/);
    expect(() => assertBalanced([line(100, 0), line(0, 100)])).not.toThrow();
  });

  it('AC6: a D1-B reclass of 7 lines totalling 1,188.41 on one account is one balanced credit/debit pair', () => {
    const amounts = [15_000, 15_000, 20_000, 20_000, 16_281, 16_280, 16_280]; // = 118,841
    const excluded = amounts.map((amountCents, i) => ({
      accountId: 'salaries',
      accountName: 'Salaries',
      txnDate: new Date(Date.UTC(2026, 5, 1 + i)),
      amountCents,
    }));
    const lines = buildReclassLines({ code: 'GAT-0002', excluded, grant: GRANT, destination: DEST });
    expect(lines).toHaveLength(2);
    expect(lines[0]).toMatchObject({ grantSide: true, creditCents: 118_841, debitCents: 0, ...GRANT });
    expect(lines[1]).toMatchObject({ grantSide: false, debitCents: 118_841, creditCents: 0, ...DEST });
    expect(lines[0]!.description).toContain('GAT-0002');
    expect(lines[0]!.description).toContain('2026-06-01 150.00');
    expect(grantSideCents(lines)).toBe(-118_841);
  });

  it('a reclass spanning two accounts produces one pair per account and skips accounts netting to zero', () => {
    const excluded = [
      { accountId: 'a', accountName: 'A', txnDate: new Date(), amountCents: 500 },
      { accountId: 'b', accountName: 'B', txnDate: new Date(), amountCents: -300 },
      { accountId: 'c', accountName: 'C', txnDate: new Date(), amountCents: 100 },
      { accountId: 'c', accountName: 'C', txnDate: new Date(), amountCents: -100 },
    ];
    const lines = buildReclassLines({ code: 'GAT-0003', excluded, grant: GRANT, destination: DEST });
    expect(lines.map((l) => l.accountId)).toEqual(['a', 'a', 'b', 'b']);
    // Negative net flips the sides: the grant is debited.
    expect(lines[2]).toMatchObject({ grantSide: true, debitCents: 300, creditCents: 0 });
    expect(grantSideCents(lines)).toBe(-200);
  });

  it('AC4: a true-up of 143.53 credits the grant and debits the destination on the payroll account; a negative variance flips', () => {
    const base = {
      code: 'GAT-0001',
      accountId: 'salaries',
      accountName: 'Salaries',
      personLabel: 'Coordinator',
      grant: { classId: null, partyId: 'proj-grant', className: null, partyName: 'Opioid Grant' },
      destination: DEST,
    };
    const lines = buildTrueUpLines({ ...base, varianceCents: 14_353 });
    expect(lines).toHaveLength(2);
    expect(lines[0]).toMatchObject({
      grantSide: true,
      partyId: 'proj-grant',
      partyName: 'Opioid Grant',
      creditCents: 14_353,
    });
    expect(lines[1]).toMatchObject({
      grantSide: false,
      classId: 'cls-admin',
      className: 'Admin',
      debitCents: 14_353,
    });
    // A grant with no QuickBooks class / project cannot be coded on the grant side.
    expect(() =>
      buildTrueUpLines({
        ...base,
        varianceCents: 14_353,
        grant: { classId: null, partyId: null, className: null, partyName: null },
      }),
    ).toThrow(GrantCodingMissingError);
    expect(lines.every((l) => l.description.includes('GAT-0001'))).toBe(true);
    expect(grantSideCents(lines)).toBe(-14_353);
    expect(grantSideCents(buildTrueUpLines({ ...base, varianceCents: -250 }))).toBe(250);
    expect(() => buildTrueUpLines({ ...base, varianceCents: 0 })).toThrow(/zero/);
  });

  it('posted detection matches a draft code only as a whole token (GAT-0001 ≠ GAT-00010)', () => {
    expect(carriesCode('GAT-0001 true-up Salaries', 'GAT-0001')).toBe(true);
    expect(carriesCode('Posted per GAT-0001.', 'GAT-0001')).toBe(true);
    expect(carriesCode('gat-0001', 'GAT-0001')).toBe(true);
    expect(carriesCode('GAT–0001 (en dash)', 'GAT-0001')).toBe(true);
    expect(carriesCode('GAT-00010 reclass', 'GAT-0001')).toBe(false);
    expect(carriesCode('XGAT-0001', 'GAT-0001')).toBe(false);
    expect(carriesCode('GAT-0010', 'GAT-0001')).toBe(false);
    expect(carriesCode(null, 'GAT-0001')).toBe(false);
  });
});
