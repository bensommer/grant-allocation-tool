import { describe, expect, it } from 'vitest';
import { closeStatus, type CloseInput } from './close-status';

const asOf = new Date('2026-03-31T00:00:00Z');
const now = new Date('2026-04-02T12:00:00Z');

function allGreen(): CloseInput {
  return {
    asOf,
    now,
    lastImport: { at: new Date('2026-03-30T00:00:00Z'), status: 'succeeded' },
    review: { count: 0, totalCents: 0, pairs: 0 },
    flaggedGrants: [],
    healthWarnings: [],
    lastCalculationFailed: false,
    effort: [],
    drafts: [],
    exportedAt: new Date('2026-04-01T00:00:00Z'),
    periodLock: { id: 'lock1', name: 'Q1 2026' },
  };
}

describe('closeStatus (JPH-28 D2)', () => {
  it('is closed with seven green steps when nothing is outstanding', () => {
    const s = closeStatus(allGreen());
    expect(s.steps.map((x) => x.n)).toEqual([1, 2, 3, 4, 5, 6, 7]);
    expect(s.steps.every((x) => x.tone === 'green')).toBe(true);
    expect(s.closed).toBe(true);
    expect(s.open).toBeNull();
  });

  it('opens the first non-green step', () => {
    const s = closeStatus({ ...allGreen(), drafts: [{ grantId: 'g', grantName: 'G', code: 'GAT-0001', amountCents: 14_353 }], exportedAt: null });
    expect(s.open).toBe('entries');
    expect(s.closed).toBe(false);
  });

  it('step 1: green within 7 days of the as-of, amber with the age, red on a failed import', () => {
    const fresh = closeStatus({ ...allGreen(), lastImport: { at: new Date('2026-03-24T00:00:00Z'), status: 'succeeded' } });
    expect(fresh.steps[0]!.tone).toBe('green');
    const old = closeStatus({ ...allGreen(), lastImport: { at: new Date('2026-03-21T00:00:00Z'), status: 'succeeded' } });
    expect(old.steps[0]!.tone).toBe('amber');
    expect(old.steps[0]!.badge).toBe('Last import 12 days ago');
    expect(old.steps[0]!.count).toBe(12);
    const failed = closeStatus({ ...allGreen(), lastImport: { at: now, status: 'failed' } });
    expect(failed.steps[0]!.tone).toBe('red');
    expect(closeStatus({ ...allGreen(), lastImport: null }).steps[0]!.tone).toBe('red');
    expect(fresh.steps[0]!.button).toEqual({ label: 'Import', href: '/import' });
  });

  it('step 2: amber with the count and integer cents, button "Review N"', () => {
    const s = closeStatus({ ...allGreen(), review: { count: 8, totalCents: 118_841, pairs: 1 } });
    const step = s.steps[1]!;
    expect(step.tone).toBe('amber');
    expect(step.cents).toBe(118_841);
    expect(step.count).toBe(8);
    expect(step.button).toEqual({ label: 'Review 8', href: '/review' });
    // Pairs alone net to zero: green, but mentioned.
    const pairsOnly = closeStatus({ ...allGreen(), review: { count: 1, totalCents: 0, pairs: 1 } }).steps[1]!;
    expect(pairsOnly.tone).toBe('green');
    expect(pairsOnly.status).toContain('1 reversal pair');
  });

  it('step 3: a failed health check is a red blocker and the period is not closed, even with nothing else outstanding', () => {
    const s = closeStatus({
      ...allGreen(),
      healthWarnings: [
        { name: 'trial_balance', label: 'Trial balance provided', status: 'fail' },
        { name: 'crosswalk_conflicts', label: 'No overlapping rules', status: 'warn' },
      ],
    });
    const step = s.steps[2]!;
    expect(step.tone).toBe('red');
    expect(step.badge).toBe('1 fail · 1 warn');
    expect(step.status).toContain('1 health check fails: Trial balance provided');
    expect(step.status).toContain('1 health check warns: No overlapping rules');
    expect(step.count).toBe(2);
    expect(s.closed).toBe(false);
    expect(s.open).toBe('budgets');
  });

  it('is never closed while the newest calculation attempt failed, even with seven green steps', () => {
    const s = closeStatus({ ...allGreen(), lastCalculationFailed: true });
    expect(s.steps.every((step) => step.tone === 'green')).toBe(true);
    expect(s.open).toBeNull();
    expect(s.closed).toBe(false);
  });

  it('step 3: amber listing flagged grants and warning health checks', () => {
    const s = closeStatus({
      ...allGreen(),
      flaggedGrants: [{ id: 'a', name: 'Culinary Workforce Grant' }, { id: 'b', name: 'Youth Meals Grant' }],
      healthWarnings: [{ name: 'unmapped_program_expense', label: 'Program expense mapped to a grant', status: 'warn' }],
    }).steps[2]!;
    expect(s.tone).toBe('amber');
    expect(s.badge).toBe('2 flagged · 1 warn');
    expect(s.status).toContain('Culinary Workforce Grant, Youth Meals Grant');
    expect(s.status).toContain('Program expense mapped to a grant');
    expect(s.button.href).toBe('/restricted');
  });

  it('step 4: sums uncarried variances in cents and links the first open schedule', () => {
    const effort = [
      { grantId: 'op', grantName: 'Opioid', personLabel: 'Coordinator', varianceCents: 14_353, carried: false },
      { grantId: 'sf', grantName: 'Salah', personLabel: 'Leah', varianceCents: 5_000, carried: true },
    ];
    const s = closeStatus({ ...allGreen(), effort }).steps[3]!;
    expect(s.tone).toBe('amber');
    expect(s.badge).toBe('$143.53 variance');
    expect(s.cents).toBe(14_353);
    expect(s.button.href).toBe('/grants/op/effort');
    const carried = closeStatus({ ...allGreen(), effort: [effort[1]!] }).steps[3]!;
    expect(carried.tone).toBe('green');
    const zero = closeStatus({ ...allGreen(), effort: [{ ...effort[0]!, varianceCents: 0 }] }).steps[3]!;
    expect(zero.tone).toBe('green');
  });

  it('step 5: amber with the drafted-entry count', () => {
    const s = closeStatus({
      ...allGreen(),
      drafts: [{ grantId: 'op', grantName: 'Opioid', code: 'GAT-0001', amountCents: 14_353 }],
    }).steps[4]!;
    expect(s.tone).toBe('amber');
    expect(s.badge).toBe('1 entry to post');
    expect(s.count).toBe(1);
    expect(s.cents).toBe(14_353);
    expect(s.button).toEqual({ label: 'Export', href: '/grants/op/entries' });
  });

  it('steps 6 and 7: amber until an export / a period lock covers the as-of', () => {
    const s = closeStatus({ ...allGreen(), exportedAt: null, periodLock: null });
    expect(s.steps[5]!.tone).toBe('amber');
    expect(s.steps[5]!.button).toEqual({ label: 'Export', href: '/grants/rollforward' });
    expect(s.steps[6]!.tone).toBe('amber');
    expect(s.steps[6]!.button.label).toBe('Lock');
    expect(s.open).toBe('export');
  });
});
