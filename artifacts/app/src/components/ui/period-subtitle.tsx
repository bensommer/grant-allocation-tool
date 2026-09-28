import { formatDate, formatPeriod } from '@/domain/format';

/**
 * The period a page shows, under its H1 (JPH-25 A1):
 * "Jan 1 – Mar 31, 2026 · books through Mar 31, 2026".
 */
export function PeriodSubtitle({
  from,
  to,
  booksThrough,
}: {
  from: Date;
  to: Date;
  booksThrough: Date | null;
}) {
  return (
    <span data-testid="period-subtitle">
      {formatPeriod(from, to)} · books through{' '}
      {booksThrough ? formatDate(booksThrough) : 'no imported transactions'}
    </span>
  );
}
