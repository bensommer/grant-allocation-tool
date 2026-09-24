export type YearMonth = `${number}-${number}`;

/** Integer cents; fractional inputs round to the nearest cent, ties away from zero. */
export function formatMoney(
  cents: number,
  { dollar = false, zero = 'dash' }: { dollar?: boolean; zero?: 'dash' | 'zero' } = {},
): string {
  if (!Number.isFinite(cents)) throw new RangeError('Money must be finite');
  const rounded = Math.sign(cents) * Math.round(Math.abs(cents));
  if (rounded === 0 && zero === 'dash') return '—';
  const amount = `${dollar ? '$' : ''}${Math.floor(Math.abs(rounded) / 100).toLocaleString('en-US')}.${String(Math.abs(rounded) % 100).padStart(2, '0')}`;
  return rounded < 0 ? `(${amount})` : amount;
}

const monthDay = new Intl.DateTimeFormat('en-US', {
  timeZone: 'UTC',
  month: 'short',
  day: 'numeric',
});
const fullDate = new Intl.DateTimeFormat('en-US', {
  timeZone: 'UTC',
  month: 'short',
  day: 'numeric',
  year: 'numeric',
});

export function formatDate(date: Date): string {
  return fullDate.format(date);
}

export function formatPeriod(from: Date, to: Date): string {
  return from.getUTCFullYear() === to.getUTCFullYear()
    ? `${monthDay.format(from)} – ${formatDate(to)}`
    : `${formatDate(from)} – ${formatDate(to)}`;
}

export function formatMonth(
  ym: YearMonth,
  { year = 'auto' }: { year?: 'auto' | 'always' | 'never' } = {},
  context: YearMonth[] = [],
): string {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(ym)) throw new RangeError(`Invalid month: ${ym}`);
  const [y, m] = ym.split('-').map(Number);
  const month = new Intl.DateTimeFormat('en-US', { month: 'short', timeZone: 'UTC' }).format(
    new Date(Date.UTC(y!, m! - 1, 1)),
  );
  const showYear =
    year === 'always' ||
    (year === 'auto' && context.some((item) => item.slice(0, 4) !== ym.slice(0, 4)));
  return `${month}${showYear ? ` ${y}` : ''}`;
}

/** Input is basis points (10000 = 100%); one decimal, half away from zero. Use formatPct1(n, d) for ratios. */
export function formatPct(basisPoints: number): string {
  if (!Number.isFinite(basisPoints)) throw new RangeError('Percentage must be finite');
  const tenths = Math.sign(basisPoints) * Math.round(Math.abs(basisPoints) / 10);
  return `${(tenths / 10).toFixed(1)}%`;
}

/** UTC display, never the browser's local time zone. */
export function formatDateTime(date: Date): string {
  const hour = String(date.getUTCHours()).padStart(2, '0');
  const minute = String(date.getUTCMinutes()).padStart(2, '0');
  return `${formatDate(date)}, ${hour}:${minute} UTC`;
}
