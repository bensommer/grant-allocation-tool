import { describe, expect, it } from 'vitest';
import { computeEffortCharges, effortHourlyRate, formatRate, type EffortEntryInput } from './effort';

/** JPH-19 §6 F pilot schedule: $75,000 salary, 765 bps burden. */
const SCHEDULE = { salaryCents: 7_500_000, hourlyRate: null, burdenBps: 765 };
const entry = (
  id: string,
  hours: string,
  completedCount: number,
  sortOrder: number,
  completedCountOverride: number | null = null,
): EffortEntryInput => ({
  id,
  activityId: `act-${id}`,
  hoursPerOccurrence: hours,
  completedCount,
  completedCountOverride,
  sortOrder,
});
const ENTRIES = [
  entry('daytime', '5.75', 10, 20),
  entry('conference', '23', 1, 30),
  entry('teen', '5.75', 6, 40),
  entry('virtual', '2', 6, 50),
  entry('sober', '5.75', 2, 10),
];
const byId = (r: ReturnType<typeof computeEffortCharges>) =>
  new Map(r.charges.map((c) => [c.entryId, c.chargeCents]));

describe('effort charges (JPH-22)', () => {
  it('AC1: $75,000 ÷ 2080 = 36.0577/h and the pilot activities charge 2,231.93 / 892.77 / 1,339.16 / 465.79 / 446.38 = 5,376.03', () => {
    const r = computeEffortCharges(SCHEDULE, ENTRIES);
    expect(formatRate(r.hourlyRate)).toBe('36.0577');
    expect(effortHourlyRate(SCHEDULE).toFixed(10)).toBe('36.0576923077');
    const c = byId(r);
    expect(c.get('daytime')).toBe(223_193);
    expect(c.get('conference')).toBe(89_277);
    expect(c.get('teen')).toBe(133_916);
    expect(c.get('virtual')).toBe(46_579);
    expect(c.get('sober')).toBe(44_638);
    expect(r.totalCents).toBe(537_603);
    expect(r.charges.reduce((s, x) => s + x.chargeCents, 0)).toBe(r.totalCents);
  });

  it('AC1: Sober Socials is 446.38 by largest remainder even though its own exact charge rounds to 446.39', () => {
    const r = computeEffortCharges(SCHEDULE, ENTRIES);
    const sober = r.charges.find((c) => c.entryId === 'sober')!;
    expect(Math.round(Number(sober.exact) * 100)).toBe(44_639);
    expect(sober.chargeCents).toBe(44_638);
  });

  it('AC7: Teen completed count 7 charges 1,562.35 (±0.01) and the total moves with it', () => {
    const seven = ENTRIES.map((e) => (e.id === 'teen' ? { ...e, completedCount: 7 } : e));
    const r = computeEffortCharges(SCHEDULE, seven);
    const teen = byId(r).get('teen')!;
    expect(Math.abs(teen - 156_235)).toBeLessThanOrEqual(1);
    expect(r.totalCents).toBeGreaterThan(537_603);
    expect(r.charges.reduce((s, x) => s + x.chargeCents, 0)).toBe(r.totalCents);
    // An override takes precedence over the activity's completed count.
    const override = ENTRIES.map((e) => (e.id === 'teen' ? { ...e, completedCountOverride: 7 } : e));
    expect(byId(computeEffortCharges(SCHEDULE, override)).get('teen')).toBe(teen);
  });

  it('charges are ordered by sort order and an explicit hourly rate beats the salary', () => {
    const r = computeEffortCharges({ ...SCHEDULE, hourlyRate: '40' }, ENTRIES);
    expect(r.charges.map((c) => c.entryId)).toEqual([
      'sober',
      'daytime',
      'conference',
      'teen',
      'virtual',
    ]);
    expect(r.hourlyRate.toString()).toBe('40');
    // 138.5 h × 40 × 1.0765 = 5,963.81
    expect(r.totalCents).toBe(596_381);
  });

  it('rejects a schedule without a rate and negative or over-precise hours', () => {
    expect(() =>
      computeEffortCharges({ salaryCents: null, hourlyRate: null, burdenBps: 0 }, ENTRIES),
    ).toThrow(/salary or an hourly rate/);
    expect(() => computeEffortCharges(SCHEDULE, [entry('x', '-1', 1, 0)])).toThrow(/≥ 0/);
    expect(() => computeEffortCharges(SCHEDULE, [entry('x', '1.005', 1, 0)])).toThrow(/two decimals/);
  });
});
