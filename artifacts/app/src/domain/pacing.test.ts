import { describe, expect, it } from 'vitest';
import { pacing, isOverBudget } from './pacing';

const d = (s: string) => new Date(s);
describe('pacing', () => {
  it('counts leap year days inclusively', () => {
    expect(pacing(36600, 0, d('2028-01-01'), d('2028-12-31'), d('2028-02-29')).elapsedDays).toBe(
      60,
    );
    expect(pacing(36600, 0, d('2028-01-01'), d('2028-12-31'), d('2028-02-29')).totalDays).toBe(366);
  });
  it('spans fiscal years and clamps outside grant period', () => {
    const args = [36500, 0, d('2027-07-01'), d('2028-06-30')] as const;
    expect(pacing(...args, d('2028-01-01')).elapsedDays).toBe(185);
    expect(pacing(...args, d('2027-06-30')).elapsedDays).toBe(0);
    expect(pacing(...args, d('2028-07-01')).elapsedDays).toBe(366);
  });
  it('rounds half-up, flags strict thresholds and line overspends', () => {
    expect(
      pacing(12000000, 3975291, d('2026-01-01'), d('2026-12-31'), d('2026-03-31')),
    ).toMatchObject({
      elapsedDays: 90,
      totalDays: 365,
      expectedCents: 2958904,
      varianceCents: 1016387,
      variancePct: '34.4%',
      flag: 'over',
    });
    expect(isOverBudget(101, 100)).toBe(true);
    expect(isOverBudget(100, 100)).toBe(false);
  });
});
