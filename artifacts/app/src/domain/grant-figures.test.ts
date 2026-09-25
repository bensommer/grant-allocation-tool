import { describe, expect, it } from 'vitest';
import {
  bookedByClass,
  deriveTrackingMode,
  grantFigures,
  receivedIn,
  trackingLabel,
  type FigureLine,
  type FiguresInput,
  type ReceiptLine,
  type SpendPiece,
} from './grant-figures';

const d = (s: string) => new Date(`${s}T00:00:00.000Z`);
const thresholds = { underPercent: 15, overPercent: 10 };

const grant = {
  awardAmountCents: 12_000_000,
  startDate: d('2026-01-01'),
  endDate: d('2026-12-31'),
  restrictionType: 'purpose',
  matchPartyIds: ['funder'],
  matchClassIds: [],
  revenueAccountId: null,
};

const lines: FigureLine[] = [
  {
    id: 'L1',
    code: 'PERS',
    name: 'Personnel',
    kind: 'working_line',
    parentId: null,
    programId: null,
    releaseClass: 'staff',
    budgetCents: 7_200_000,
    sortOrder: 1,
  },
  {
    id: 'L2',
    code: 'SUPP',
    name: 'Supplies',
    kind: 'working_line',
    parentId: null,
    programId: null,
    releaseClass: 'direct',
    budgetCents: 2_400_000,
    sortOrder: 2,
  },
];

const piece = (
  budgetLineId: string | null,
  amountCents: number,
  txnDate: string | null,
  source: SpendPiece['source'] = 'transaction',
): SpendPiece => ({ budgetLineId, amountCents, txnDate: txnDate ? d(txnDate) : null, source });

const receipt = (
  id: string,
  amountCents: number,
  txnDate: string,
  extra: Partial<ReceiptLine> = {},
): ReceiptLine => ({
  id,
  amountCents,
  txnDate: d(txnDate),
  accountId: 'inc',
  accountType: 'Income',
  classId: null,
  transactionPartyId: 'funder',
  linePartyId: null,
  member: false,
  ...extra,
});

const base: FiguresInput = {
  mode: 'crosswalk',
  grant,
  asOf: d('2026-03-31'),
  lines,
  pieces: [
    piece('L1', 1_000_000, '2026-01-15'),
    piece('L1', 500_000, '2026-03-31'),
    piece('L2', 200_000, '2026-02-01'),
    piece('L2', 999, '2026-04-01'), // after as-of
    piece('L1', 777, '2025-12-31'), // before the grant period
  ],
  receipts: [
    receipt('r1', 3_000_000, '2026-01-05'),
    receipt('r2', 3_000_000, '2026-04-02'), // after as-of
    receipt('r3', 50_000, '2026-02-01', { transactionPartyId: 'someone-else' }),
    receipt('r4', 100, '2025-12-30'), // before the grant period
  ],
  needsReview: { count: 3, cents: 12_345 },
  thresholds,
};

describe('deriveTrackingMode', () => {
  const none = {
    trackingMode: 'crosswalk' as const,
    memberClassIds: [],
    memberPartyIds: [],
    membershipCount: 0,
    scopedImportCount: 0,
    importedUploadCount: 0,
  };
  it('is crosswalk without any membership signal', () => {
    expect(deriveTrackingMode(none)).toBe('crosswalk');
    expect(deriveTrackingMode({ ...none, trackingMode: null })).toBe('crosswalk');
  });
  it('is membership with member classes, projects, member rows or a scoped report import', () => {
    expect(deriveTrackingMode({ ...none, memberClassIds: ['c'] })).toBe('membership');
    expect(deriveTrackingMode({ ...none, memberPartyIds: ['p'] })).toBe('membership');
    expect(deriveTrackingMode({ ...none, membershipCount: 1 })).toBe('membership');
    expect(deriveTrackingMode({ ...none, scopedImportCount: 1 })).toBe('membership');
    expect(deriveTrackingMode({ ...none, importedUploadCount: 1 })).toBe('membership');
  });
  it('keeps a backfilled membership column even when the signals are gone', () => {
    expect(deriveTrackingMode({ ...none, trackingMode: 'membership' })).toBe('membership');
  });
});

describe('trackingLabel', () => {
  const names = { qboClassName: null, qboProjectName: null };
  it('names the class, then the project, then falls back', () => {
    expect(trackingLabel('crosswalk', names)).toBe('Tracked by crosswalk rules');
    expect(trackingLabel('membership', { ...names, qboClassName: 'Trauma Grants' })).toBe(
      'Tracked by QuickBooks class: Trauma Grants',
    );
    expect(
      trackingLabel('membership', { ...names, qboProjectName: '2025-2026 Opioid Grant' }),
    ).toBe('Tracked by QuickBooks project: 2025-2026 Opioid Grant');
    expect(trackingLabel('membership', { ...names, memberProjectNames: ['P'] })).toBe(
      'Tracked by QuickBooks project: P',
    );
    expect(trackingLabel('membership', names)).toBe('Tracked by QuickBooks member lines');
  });
});

describe('grantFigures — crosswalk mode', () => {
  const f = grantFigures(base);
  it('counts pieces inside the grant period through as-of, per line and in total', () => {
    expect(f.mode).toBe('crosswalk');
    expect(f.spentByBudgetLine.map((l) => [l.code, l.spentCents, l.remainingCents])).toEqual([
      ['PERS', 1_500_000, 5_700_000],
      ['SUPP', 200_000, 2_200_000],
    ]);
    expect(f.spentByBudgetLine[0]!.monthly).toEqual({ '2026-01': 1_000_000, '2026-03': 500_000 });
    expect(f.spentCents).toBe(1_700_000);
    expect(f.budgetCents).toBe(9_600_000);
  });
  it('receives only matcher lines inside the grant period through as-of', () => {
    expect(f.receivedCents).toBe(3_000_000);
    expect(f.restrictedBalanceCents).toBe(1_300_000);
    expect(f.remainingAwardCents).toBe(10_300_000);
  });
  it('paces straight-line from award and grant dates', () => {
    expect(f.expectedCents).toBe(Math.round((12_000_000 * 90) / 365));
    expect(f.pacing.expectedCents).toBe(f.expectedCents);
    expect(f.pacing.flag).toBe('under');
    expect(f.flagged).toBe(true);
    expect(f.elapsedBps).toBe(Math.round((90 / 365) * 10000));
    expect(f.spentBps).toBe(Math.round((1_700_000 / 12_000_000) * 10000));
    expect(f.pacePts).toBe(14 - 25);
  });
  it('has no review queue or effort in crosswalk mode', () => {
    expect(f.needsReviewCount).toBe(0);
    expect(f.needsReviewCents).toBe(0);
    expect(f.effortCents).toBe(0);
  });
  it('releases by the budget line class, defaulting direct for unmapped pieces', () => {
    expect(f.releasedByClass).toEqual({ direct: 200_000, staff: 1_500_000, overhead: 0 });
    expect(
      bookedByClass('crosswalk', grant, lines, [piece(null, 5, '2026-02-02')], {
        to: d('2026-03-31'),
      }),
    ).toEqual({ direct: 5, staff: 0, overhead: 0 });
  });
});

describe('grantFigures — membership mode', () => {
  const m = grantFigures({
    ...base,
    mode: 'membership',
    pieces: [
      ...base.pieces,
      piece('L1', 40_000, null, 'effort'),
      piece(null, 1_000, null, 'effort'),
    ],
    receipts: [
      ...base.receipts,
      receipt('m1', 250_000, '2025-12-15', { transactionPartyId: null, member: true }),
    ],
  });
  it('counts dated member lines through as-of (no grant-period clip) plus all effort charges', () => {
    expect(m.mode).toBe('membership');
    expect(m.spentCents).toBe(1_700_000 + 777 + 41_000);
    expect(m.effortCents).toBe(41_000);
    expect(m.spentByBudgetLine[0]!).toMatchObject({
      spentCents: 1_500_777,
      effortCents: 40_000,
      chargedCents: 1_540_777,
    });
  });
  it('counts member income lines and matcher lines once each, through as-of', () => {
    expect(m.receivedCents).toBe(3_000_000 + 100 + 250_000);
    expect(m.restrictedBalanceCents).toBe(m.receivedCents - m.spentCents);
    expect(
      receivedIn('membership', grant, [receipt('x', 7, '2026-01-01', { member: true })], {}),
    ).toBe(7);
  });
  it('carries the review queue totals and puts unmapped effort under staff', () => {
    expect(m.needsReviewCount).toBe(3);
    expect(m.needsReviewCents).toBe(12_345);
    expect(m.releasedByClass).toEqual({ direct: 200_000, staff: 1_500_777 + 41_000, overhead: 0 });
  });
});
