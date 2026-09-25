/**
 * Pure period arithmetic for the rollforward, working view and activity grid
 * (JPH-23). Everything is integer cents; divisions round half-up.
 */
import { daysInclusive } from '@/domain/dates';
import { roundHalfUpDiv } from '@/domain/money';

export type ReleaseClass = 'direct' | 'staff' | 'overhead';
export const RELEASE_CLASSES: readonly ReleaseClass[] = ['direct', 'staff', 'overhead'];
export const RELEASE_CLASS_LABEL: Record<ReleaseClass, string> = {
  direct: 'Direct expenses',
  staff: 'Staff costs',
  overhead: 'Overhead',
};

export type ByClass = Record<ReleaseClass, number>;
export const zeroByClass = (): ByClass => ({ direct: 0, staff: 0, overhead: 0 });
export function addByClass(a: ByClass, b: ByClass, sign = 1): ByClass {
  return {
    direct: a.direct + sign * b.direct,
    staff: a.staff + sign * b.staff,
    overhead: a.overhead + sign * b.overhead,
  };
}
export const sumByClass = (c: ByClass): number => c.direct + c.staff + c.overhead;

export interface RollforwardColumn {
  beginningCents: number;
  receivedCents: number;
  released: ByClass;
  endingCents: number;
}

/** Ending = beginning + received − Σ released; the check ties the same arithmetic on the totals. */
export function rollforwardColumn(
  beginningCents: number,
  receivedCents: number,
  released: ByClass,
): RollforwardColumn {
  return {
    beginningCents,
    receivedCents,
    released,
    endingCents: beginningCents + receivedCents - sumByClass(released),
  };
}

export function rollforwardTotals(columns: RollforwardColumn[]): RollforwardColumn & {
  checkCents: number;
} {
  const t = columns.reduce<RollforwardColumn>(
    (acc, c) => ({
      beginningCents: acc.beginningCents + c.beginningCents,
      receivedCents: acc.receivedCents + c.receivedCents,
      released: addByClass(acc.released, c.released),
      endingCents: acc.endingCents + c.endingCents,
    }),
    { beginningCents: 0, receivedCents: 0, released: zeroByClass(), endingCents: 0 },
  );
  // Same check as the workbook: totals column recomputed from its own rows minus Σ endings.
  const checkCents = t.beginningCents + t.receivedCents - sumByClass(t.released) - t.endingCents;
  return { ...t, checkCents };
}

/** Remaining spread over the occurrences still to run; null when none remain. */
export function perRemainingOccurrence(
  remainingCents: number,
  plannedCount: number,
  completedCount: number,
): number | null {
  const left = plannedCount - completedCount;
  if (left <= 0) return null;
  return roundHalfUpDiv(remainingCents, left);
}

/**
 * Months left in the grant from `asOf` (inclusive) to `endDate`, to one decimal,
 * from the grant dates alone: days left ÷ (365.25 / 12). Zero once the grant has ended.
 */
export function monthsLeft(asOf: Date, endDate: Date): number {
  const days = daysInclusive(asOf, endDate);
  if (days <= 0) return 0;
  return Math.round((days / (365.25 / 12)) * 10) / 10;
}

/** Remaining ÷ months left, rounded half-up; null when the grant has ended. */
export function perMonthRemaining(remainingCents: number, months: number): number | null {
  if (months <= 0) return null;
  // months has one decimal: scale both sides by 10 to stay in integers.
  return roundHalfUpDiv(remainingCents * 10, Math.round(months * 10));
}

/** Share of the grant period elapsed at `asOf`, in basis points (0..10000). */
export function elapsedBps(startDate: Date, endDate: Date, asOf: Date): number {
  const total = daysInclusive(startDate, endDate);
  if (total <= 0) return 10000;
  const done = Math.min(total, Math.max(0, daysInclusive(startDate, asOf)));
  return Math.round((done / total) * 10000);
}

/** Straight-line projection of spend to the grant end from the pace so far; null before day one. */
export function projectedAtEnd(spentCents: number, startDate: Date, endDate: Date, asOf: Date) {
  const total = daysInclusive(startDate, endDate);
  const done = Math.min(total, daysInclusive(startDate, asOf));
  if (done <= 0 || total <= 0) return null;
  return roundHalfUpDiv(spentCents * total, done);
}

export interface PlannedEntry {
  count: number;
  hours: string;
  /** dollars per hour as entered */
  rate: string;
}

/** count × hours × rate in cents, half-up per entry. */
export function plannedEntryCents(e: PlannedEntry): number {
  const hours = Number(e.hours);
  const rate = Number(e.rate);
  if (!Number.isFinite(hours) || !Number.isFinite(rate) || e.count < 0) return 0;
  return Math.round(e.count * hours * rate * 100 + Number.EPSILON);
}
