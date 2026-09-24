import { parseDateInput, toISODate } from '@/domain/dates';

export function dateRange(from?: string, to?: string) {
  const year = new Date().getFullYear();
  const start = from ?? `${year}-01-01`;
  const end = to ?? `${year}-12-31`;
  try {
    const first = parseDateInput(start);
    const last = parseDateInput(end);
    if (first > last) throw new Error('End date is before start date');
    return { from: toISODate(first), to: toISODate(last), first, last, error: null };
  } catch {
    return {
      from: start,
      to: end,
      first: null,
      last: null,
      error: 'Enter a valid date range (from must be before to).',
    };
  }
}
