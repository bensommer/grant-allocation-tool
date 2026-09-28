import { cookies } from 'next/headers';
import { parseDateInput } from '@/domain/dates';
import {
  defaultRange,
  resolveAsOf,
  type DateRange,
  type PeriodOrg,
  type ResolvedAsOf,
} from '@/domain/period';
import { prisma } from '@/lib/db';
import { lastImportedTransactionDate } from '@/services/grant-figures';

export interface CurrentPeriod extends ResolvedAsOf {
  /** [fiscal year start, as-of] — what every range page shows when From/To are blank. */
  range: DateRange;
  /** Latest imported transaction date (null before the first import). */
  booksThrough: Date | null;
  org: PeriodOrg;
}

/**
 * The one period for the request (JPH-25 A1): `?asOf=` → `gat_asof` cookie →
 * books-through. Pages and layouts call this; route handlers that carry `asOf`
 * in their links keep using `defaultReportDate`.
 */
export async function currentPeriod(
  orgId: string,
  searchParams: { asOf?: string | string[] | undefined } = {},
): Promise<CurrentPeriod> {
  const [org, booksThrough, jar] = await Promise.all([
    prisma.org.findUniqueOrThrow({
      where: { id: orgId },
      select: { fiscalYearStartMonth: true },
    }),
    lastImportedTransactionDate(orgId),
    cookies(),
  ]);
  const periodOrg: PeriodOrg = { fiscalYearStartMonth: org.fiscalYearStartMonth, booksThrough };
  const asOf = resolveAsOf(searchParams, jar, periodOrg);
  return { ...asOf, range: defaultRange(asOf.date, periodOrg), booksThrough, org: periodOrg };
}

export interface CurrentRange {
  period: CurrentPeriod;
  from: Date;
  to: Date;
  /** ISO strings for form defaults. */
  fromLabel: string;
  toLabel: string;
  error: string | null;
}

/**
 * `?from=&to=` with the app default range filling any blank. Malformed dates keep
 * the typed text in the form and report one error instead of throwing.
 */
export async function currentRange(
  orgId: string,
  searchParams: { asOf?: string; from?: string; to?: string },
): Promise<CurrentRange> {
  const period = await currentPeriod(orgId, searchParams);
  let from = period.range.from;
  let to = period.range.to;
  let error: string | null = null;
  try {
    if (searchParams.from) from = parseDateInput(searchParams.from);
    if (searchParams.to) to = parseDateInput(searchParams.to);
    if (from > to) error = 'Enter a valid date range (from must be before to).';
  } catch {
    error = 'Enter a valid date range (from must be before to).';
  }
  return {
    period,
    from,
    to,
    fromLabel: searchParams.from || from.toISOString().slice(0, 10),
    toLabel: searchParams.to || to.toISOString().slice(0, 10),
    error,
  };
}
