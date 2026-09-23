/** Dates are stored as Postgres DATE and handled as UTC-midnight Date objects. */

export function parseDateInput(raw: string): Date {
  const s = raw.trim();
  let y: number, m: number, d: number;
  let match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (match) {
    y = Number(match[1]);
    m = Number(match[2]);
    d = Number(match[3]);
  } else {
    match = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(s);
    if (!match) throw new Error(`Invalid date: "${raw}"`);
    m = Number(match[1]);
    d = Number(match[2]);
    y = Number(match[3]);
  }
  const date = new Date(Date.UTC(y, m - 1, d));
  if (date.getUTCFullYear() !== y || date.getUTCMonth() !== m - 1 || date.getUTCDate() !== d) {
    throw new Error(`Invalid date: "${raw}"`);
  }
  return date;
}

export function toISODate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function utcDate(y: number, m: number, d: number): Date {
  return new Date(Date.UTC(y, m - 1, d));
}

export function monthKey(date: Date): string {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
}

export function quarterKey(date: Date): string {
  return `${date.getUTCFullYear()}-Q${Math.floor(date.getUTCMonth() / 3) + 1}`;
}

export function endOfMonth(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0));
}

/** Inclusive day count between two UTC dates. */
export function daysInclusive(from: Date, to: Date): number {
  return Math.floor((to.getTime() - from.getTime()) / 86_400_000) + 1;
}

export function formatDate(date: Date): string {
  return toISODate(date);
}
