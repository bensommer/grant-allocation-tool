/** YYYY-MM keys from the grant start through min(asOf, grant end). */
export function grantMonths(start: Date, end: Date, asOf: Date, all = false): string[] {
  const months: string[] = [];
  const last = all || asOf > end ? end : asOf;
  for (
    let index = start.getUTCFullYear() * 12 + start.getUTCMonth();
    index <= last.getUTCFullYear() * 12 + last.getUTCMonth();
    index++
  ) {
    months.push(`${Math.floor(index / 12)}-${String((index % 12) + 1).padStart(2, '0')}`);
  }
  return months;
}
