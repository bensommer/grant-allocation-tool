import { toISODate, utcDate } from '@/domain/dates';

/**
 * One period for the whole app (JPH-25 A1).
 *
 * The as-of date is read, in order, from `?asOf=`, the `gat_asof` cookie, then the
 * books-through date (the latest imported transaction). Date ranges default to
 * [fiscal year start, as-of]; the fiscal year start month is an org setting.
 */
export const AS_OF_COOKIE = 'gat_asof';

export interface PeriodOrg {
  /** 1 = January … 12 = December. */
  fiscalYearStartMonth: number;
  /** Latest imported transaction date; null before the first import. */
  booksThrough: Date | null;
}

export type AsOfSource = 'query' | 'cookie' | 'books' | 'today';

export interface ResolvedAsOf {
  date: Date;
  /** ISO YYYY-MM-DD, for form defaults and links. */
  label: string;
  source: AsOfSource;
}

export interface DateRange {
  from: Date;
  to: Date;
}

type SearchParamsLike = URLSearchParams | { asOf?: string | string[] | undefined };
type CookiesLike =
  | { get(name: string): { value: string } | undefined }
  | Record<string, string | undefined>
  | undefined;

const ISO = /^\d{4}-\d{2}-\d{2}$/;

/** Strict YYYY-MM-DD → UTC-midnight Date, or null when malformed or not a real date. */
export function parseISODateOrNull(raw: string | undefined | null): Date | null {
  if (!raw || !ISO.test(raw)) return null;
  const date = new Date(`${raw}T00:00:00.000Z`);
  return Number.isNaN(date.getTime()) || toISODate(date) !== raw ? null : date;
}

function queryAsOf(searchParams: SearchParamsLike): string | undefined {
  if (searchParams instanceof URLSearchParams) return searchParams.get('asOf') ?? undefined;
  const raw = searchParams.asOf;
  return Array.isArray(raw) ? raw[0] : raw;
}

function cookieAsOf(cookies: CookiesLike): string | undefined {
  if (!cookies) return undefined;
  if (typeof (cookies as { get?: unknown }).get === 'function')
    return (cookies as { get(name: string): { value: string } | undefined }).get(AS_OF_COOKIE)
      ?.value;
  return (cookies as Record<string, string | undefined>)[AS_OF_COOKIE];
}

/**
 * `?asOf=` → cookie → books-through → today. A malformed `?asOf=` is an error (the
 * user typed it); a malformed cookie is ignored.
 */
export function resolveAsOf(
  searchParams: SearchParamsLike,
  cookies: CookiesLike,
  org: PeriodOrg,
): ResolvedAsOf {
  const fromQuery = queryAsOf(searchParams);
  if (fromQuery !== undefined && fromQuery !== '') {
    const date = parseISODateOrNull(fromQuery);
    if (!date) throw new Error('Invalid as-of date; expected YYYY-MM-DD');
    return { date, label: toISODate(date), source: 'query' };
  }
  const fromCookie = parseISODateOrNull(cookieAsOf(cookies));
  if (fromCookie) return { date: fromCookie, label: toISODate(fromCookie), source: 'cookie' };
  if (org.booksThrough) {
    const date = utcDate(
      org.booksThrough.getUTCFullYear(),
      org.booksThrough.getUTCMonth() + 1,
      org.booksThrough.getUTCDate(),
    );
    return { date, label: toISODate(date), source: 'books' };
  }
  const now = new Date();
  const today = utcDate(now.getUTCFullYear(), now.getUTCMonth() + 1, now.getUTCDate());
  return { date: today, label: toISODate(today), source: 'today' };
}

/** First day of the fiscal year that contains `asOf`. */
export function fiscalYearStart(asOf: Date, org: Pick<PeriodOrg, 'fiscalYearStartMonth'>): Date {
  const month = Math.min(12, Math.max(1, Math.trunc(org.fiscalYearStartMonth) || 1));
  const y = asOf.getUTCFullYear();
  const m = asOf.getUTCMonth() + 1;
  return utcDate(m >= month ? y : y - 1, month, 1);
}

/** The range every page defaults to: fiscal year start through as-of. */
export function defaultRange(asOf: Date, org: Pick<PeriodOrg, 'fiscalYearStartMonth'>): DateRange {
  return { from: fiscalYearStart(asOf, org), to: asOf };
}

export const MONTH_NAMES = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
] as const;
