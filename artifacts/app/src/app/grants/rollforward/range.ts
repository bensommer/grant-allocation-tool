import { parseDateInput } from '@/domain/dates';
import { prisma } from '@/lib/db';
import { booksThrough } from '@/services/grant-figures';
import { defaultRollforwardRange } from '@/services/grant-periods';

export const RANGE_PRESETS = ['fy', 'last-closed', 'grant-to-date', 'custom'] as const;
export type RangePreset = (typeof RANGE_PRESETS)[number];

export const RANGE_PRESET_LABEL: Record<RangePreset, string> = {
  fy: 'Fiscal year to date',
  'last-closed': 'Last closed period',
  'grant-to-date': 'Grant-to-date',
  custom: 'Custom',
};

export interface ResolvedRange {
  from: Date;
  to: Date;
  preset: RangePreset;
  error: string | null;
  /** Why a preset fell back to the fiscal year (no closed period, no grants). */
  fallback: string | null;
  /** `to` is the books-through date (the last imported transaction), not a date the user chose. */
  booksThrough: boolean;
}

/**
 * Resolve ?range (preset) or ?from&to (custom). Presets: the org's fiscal year to
 * books-through (default), the most recently locked period, or the earliest active
 * grant's start through books-through. "Books through" is the last imported
 * transaction date — the same as-of the other pages default to (JPH-30) — falling
 * back to today when nothing has been imported. All GET, so the URL is the report.
 */
export async function resolveRange(
  orgId: string,
  q: { range?: string; from?: string; to?: string },
): Promise<ResolvedRange> {
  const [org, books] = await Promise.all([
    prisma.org.findFirstOrThrow({
      where: { id: orgId },
      select: { fiscalYearStartMonth: true },
    }),
    booksThrough(orgId),
  ]);
  const fy = defaultRollforwardRange(org.fiscalYearStartMonth, books);
  const preset: RangePreset = (RANGE_PRESETS as readonly string[]).includes(q.range ?? '')
    ? (q.range as RangePreset)
    : q.from || q.to
      ? 'custom'
      : 'fy';
  let from = fy.from;
  let to = fy.to;
  let error: string | null = null;
  let fallback: string | null = null;
  if (preset === 'custom') {
    try {
      if (q.from) from = parseDateInput(q.from);
      if (q.to) to = parseDateInput(q.to);
    } catch {
      error = 'Enter dates as YYYY-MM-DD.';
    }
  } else if (preset === 'last-closed') {
    const lock = await prisma.periodLock.findFirst({
      where: { orgId },
      orderBy: [{ periodTo: 'desc' }, { lockedAt: 'desc' }],
      select: { periodFrom: true, periodTo: true },
    });
    if (lock) {
      from = lock.periodFrom;
      to = lock.periodTo;
    } else fallback = 'No period has been closed yet; showing the fiscal year to date.';
  } else if (preset === 'grant-to-date') {
    const first = await prisma.grant.findFirst({
      where: { orgId, status: { not: 'archived' } },
      orderBy: { startDate: 'asc' },
      select: { startDate: true },
    });
    if (first) from = first.startDate;
    else fallback = 'No active grants; showing the fiscal year to date.';
  }
  if (from > to) error = 'From must not be after To.';
  return { from, to, preset, error, fallback, booksThrough: to.getTime() === books.getTime() };
}
