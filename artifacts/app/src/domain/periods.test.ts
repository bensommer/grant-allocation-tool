import { describe, expect, it } from 'vitest';
import {
  addByClass,
  elapsedBps,
  monthsLeft,
  perMonthRemaining,
  perRemainingOccurrence,
  plannedEntryCents,
  projectedAtEnd,
  rollforwardColumn,
  rollforwardTotals,
  sumByClass,
  zeroByClass,
} from './periods';

const d = (s: string) => new Date(`${s}T00:00:00Z`);

describe('release classes', () => {
  it('addByClass adds and subtracts per class without touching its inputs', () => {
    const a = { direct: 100, staff: 200, overhead: 300 };
    const b = { direct: 1, staff: 2, overhead: 3 };
    expect(addByClass(a, b)).toEqual({ direct: 101, staff: 202, overhead: 303 });
    expect(addByClass(a, b, -1)).toEqual({ direct: 99, staff: 198, overhead: 297 });
    expect(a).toEqual({ direct: 100, staff: 200, overhead: 300 });
    expect(sumByClass(zeroByClass())).toBe(0);
  });
});

describe('rollforward arithmetic', () => {
  it('ending = beginning + received − Σ released, in integer cents', () => {
    const c = rollforwardColumn(1_404_700, 0, { direct: 510_654, staff: 522_656, overhead: 0 });
    expect(c.endingCents).toBe(371_390);
  });

  it('totals sum every row and the check row ties to zero', () => {
    const t = rollforwardTotals([
      rollforwardColumn(1_404_700, 0, { direct: 510_654, staff: 522_656, overhead: 0 }),
      rollforwardColumn(0, 5_000_000, { direct: 2_270_881, staff: 0, overhead: 0 }),
    ]);
    expect(t.beginningCents).toBe(1_404_700);
    expect(t.receivedCents).toBe(5_000_000);
    expect(t.released).toEqual({ direct: 2_781_535, staff: 522_656, overhead: 0 });
    expect(t.endingCents).toBe(3_100_509);
    expect(t.checkCents).toBe(0);
  });

  it('the check row surfaces an ending that was not derived from its own rows', () => {
    const bad = { ...rollforwardColumn(100, 0, zeroByClass()), endingCents: 99 };
    expect(rollforwardTotals([bad]).checkCents).toBe(1);
  });

  it('an empty rollforward is all zeros', () => {
    expect(rollforwardTotals([])).toEqual({
      beginningCents: 0,
      receivedCents: 0,
      released: zeroByClass(),
      endingCents: 0,
      checkCents: 0,
    });
  });
});

describe('activity grid pacing', () => {
  it('per remaining occurrence rounds half-up and is null once none remain', () => {
    expect(perRemainingOccurrence(316_000, 12, 4)).toBe(39_500);
    expect(perRemainingOccurrence(1_001, 3, 0)).toBe(334); // 333.67 → 334
    expect(perRemainingOccurrence(-1_001, 3, 0)).toBe(-334); // over budget stays negative
    expect(perRemainingOccurrence(500, 4, 4)).toBeNull();
    expect(perRemainingOccurrence(500, 4, 6)).toBeNull();
  });
});

describe('working view pacing', () => {
  it('months left comes from the grant dates alone, to one decimal', () => {
    expect(monthsLeft(d('2026-09-22'), d('2027-02-28'))).toBe(5.3);
    expect(monthsLeft(d('2027-03-01'), d('2027-02-28'))).toBe(0);
    expect(monthsLeft(d('2026-01-01'), d('2026-12-31'))).toBe(12);
  });

  it('per month remaining divides by tenths of a month and is null after the end', () => {
    expect(perMonthRemaining(530_000, 5.3)).toBe(100_000);
    expect(perMonthRemaining(100_000, 3)).toBe(33_333);
    expect(perMonthRemaining(100_001, 0)).toBeNull();
  });

  it('elapsed share is clamped to 0..10000 bps', () => {
    expect(elapsedBps(d('2026-01-01'), d('2026-12-31'), d('2025-06-01'))).toBe(0);
    expect(elapsedBps(d('2026-01-01'), d('2026-01-10'), d('2026-01-05'))).toBe(5000); // 5 of 10 days
    expect(elapsedBps(d('2026-01-01'), d('2026-12-31'), d('2027-06-01'))).toBe(10000);
    expect(elapsedBps(d('2026-01-01'), d('2025-12-31'), d('2026-01-01'))).toBe(10000);
  });

  it('projected spend at end is straight-line from the pace so far', () => {
    expect(projectedAtEnd(50_000, d('2026-01-01'), d('2026-01-10'), d('2026-01-05'))).toBe(100_000);
    expect(projectedAtEnd(50_000, d('2026-01-01'), d('2026-12-31'), d('2025-12-31'))).toBeNull();
    expect(projectedAtEnd(50_000, d('2026-01-01'), d('2026-12-31'), d('2027-06-01'))).toBe(50_000);
  });

  it('planned entries price count × hours × rate in cents, ignoring malformed input', () => {
    expect(plannedEntryCents({ count: 4, hours: '2', rate: '55.25' })).toBe(44_200);
    expect(plannedEntryCents({ count: 3, hours: '1.1', rate: '0.1' })).toBe(33); // 0.33
    expect(plannedEntryCents({ count: 1, hours: 'abc', rate: '10' })).toBe(0);
    expect(plannedEntryCents({ count: -1, hours: '1', rate: '10' })).toBe(0);
  });
});
