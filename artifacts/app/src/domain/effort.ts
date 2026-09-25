/**
 * Effort charges (JPH-22, JPH-19 §6 F) — pure.
 *
 * hourly rate    = explicit rate, else annual salary ÷ 2080 hours
 * exact charge_i = hours_i × count_i × rate × (1 + burden bps ÷ 10 000)
 * total          = round-half-up(Σ exact charge_i) to the cent
 * charge_i cents = largest-remainder share of the rounded total, weighted by
 *                  hours_i × count_i (ties → lowest entry sort order), so the
 *                  lines always sum exactly to the rounded total.
 *
 * This is the only place decimal math is allowed; everything leaving here is
 * integer cents. decimal.js is used so 75,000 ÷ 2080 is not a binary float.
 */
import Decimal from 'decimal.js';
import { splitLargestRemainder } from './split';

export const STANDARD_ANNUAL_HOURS = 2080;

Decimal.set({ precision: 40, rounding: Decimal.ROUND_HALF_UP });

export interface EffortScheduleInput {
  /** Annual salary in integer cents; ignored when hourlyRate is given. */
  salaryCents: number | null;
  /** Explicit hourly rate as a decimal string, e.g. "36.0577". */
  hourlyRate: string | null;
  /** Fringe/burden in basis points, e.g. 765 = 7.65 %. */
  burdenBps: number;
}

export interface EffortEntryInput {
  id: string;
  activityId: string;
  /** Hours per completed occurrence as a decimal string, e.g. "5.75". */
  hoursPerOccurrence: string;
  /** GrantActivity.completedCount. */
  completedCount: number;
  /** Overrides completedCount when set. */
  completedCountOverride: number | null;
  sortOrder: number;
}

export interface EffortCharge {
  entryId: string;
  activityId: string;
  hoursPerOccurrence: string;
  count: number;
  /** Total hours (hours × count) as a decimal string. */
  hours: string;
  /** Unrounded charge as a decimal string (for display/debugging only). */
  exact: string;
  chargeCents: number;
}

export interface EffortComputation {
  /** Burdened hourly rate is not stored: rate is shown unburdened. */
  hourlyRate: Decimal;
  charges: EffortCharge[];
  totalCents: number;
}

export class EffortInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'EffortInputError';
  }
}

export function effortHourlyRate(s: EffortScheduleInput): Decimal {
  if (s.hourlyRate !== null && s.hourlyRate !== '') {
    const r = new Decimal(s.hourlyRate);
    if (!r.isFinite() || r.lte(0)) throw new EffortInputError('Hourly rate must be positive');
    return r;
  }
  if (s.salaryCents === null || !Number.isInteger(s.salaryCents) || s.salaryCents <= 0)
    throw new EffortInputError('Enter an annual salary or an hourly rate');
  return new Decimal(s.salaryCents).div(100).div(STANDARD_ANNUAL_HOURS);
}

export function effortCount(e: Pick<EffortEntryInput, 'completedCount' | 'completedCountOverride'>) {
  const n = e.completedCountOverride ?? e.completedCount;
  if (!Number.isInteger(n) || n < 0) throw new EffortInputError('Count must be a whole number ≥ 0');
  return n;
}

export function computeEffortCharges(
  schedule: EffortScheduleInput,
  entries: EffortEntryInput[],
): EffortComputation {
  if (!Number.isInteger(schedule.burdenBps) || schedule.burdenBps < 0)
    throw new EffortInputError('Burden must be whole basis points ≥ 0');
  const rate = effortHourlyRate(schedule);
  const burdened = rate.mul(new Decimal(10_000 + schedule.burdenBps).div(10_000));
  const ordered = [...entries].sort((a, b) => a.sortOrder - b.sortOrder || a.id.localeCompare(b.id));
  if (ordered.length === 0) return { hourlyRate: rate, charges: [], totalCents: 0 };

  const rows = ordered.map((e) => {
    const hoursEach = new Decimal(e.hoursPerOccurrence);
    if (!hoursEach.isFinite() || hoursEach.lt(0))
      throw new EffortInputError('Hours per occurrence must be ≥ 0');
    if (hoursEach.decimalPlaces() > 2)
      throw new EffortInputError('Hours per occurrence: at most two decimals');
    const count = effortCount(e);
    const hours = hoursEach.mul(count);
    return { e, count, hoursEach, hours, exact: hours.mul(burdened) };
  });
  const exactTotal = rows.reduce((s, r) => s.plus(r.exact), new Decimal(0));
  const totalCents = exactTotal.mul(100).toDecimalPlaces(0, Decimal.ROUND_HALF_UP).toNumber();
  // Weights: total hours in hundredths (integers), which is proportional to the
  // exact charge because rate and burden are common factors.
  const weights = rows.map((r) => r.hours.mul(100).toDecimalPlaces(0).toNumber());
  const cents =
    weights.every((w) => w === 0) ? rows.map(() => 0) : splitLargestRemainder(totalCents, weights);
  return {
    hourlyRate: rate,
    totalCents,
    charges: rows.map((r, i) => ({
      entryId: r.e.id,
      activityId: r.e.activityId,
      hoursPerOccurrence: r.hoursEach.toFixed(2),
      count: r.count,
      hours: r.hours.toFixed(2),
      exact: r.exact.toFixed(6),
      chargeCents: cents[i]!,
    })),
  };
}

/** Rate for display: 4 decimals, e.g. "36.0577". */
export function formatRate(rate: Decimal): string {
  return rate.toFixed(4, Decimal.ROUND_HALF_UP);
}
