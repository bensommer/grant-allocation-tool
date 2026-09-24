/**
 * Money is integer cents everywhere. These helpers never touch floats when
 * parsing user/CSV input: they parse the decimal string directly.
 */

export const MAX_CENTS = 2_147_483_647; // Int32 column limit

export class MoneyParseError extends Error {
  constructor(
    public readonly input: string,
    message: string,
  ) {
    super(`${message}: "${input}"`);
    this.name = 'MoneyParseError';
  }
}

/**
 * Accepts "1234.56", "$1,234.56", "(1,234.56)" (negative), "-12.5", "0.10", "7".
 * Rejects exponents, more than 2 decimals, and anything non-numeric.
 */
export function parseMoneyToCents(raw: string): number {
  const input = raw;
  let s = raw.trim();
  if (s === '') throw new MoneyParseError(input, 'Empty amount');
  let negative = false;
  if (s.startsWith('(') && s.endsWith(')')) {
    negative = true;
    s = s.slice(1, -1).trim();
  }
  if (s.startsWith('-')) {
    negative = !negative;
    s = s.slice(1).trim();
  } else if (s.startsWith('+')) {
    s = s.slice(1).trim();
  }
  if (s.startsWith('$')) s = s.slice(1).trim();
  if (s.endsWith('-')) {
    negative = !negative;
    s = s.slice(0, -1).trim();
  }
  // Validate thousands separators strictly if present.
  const m = /^(\d{1,3}(,\d{3})*|\d+)(\.(\d{0,2}))?$/.exec(s);
  if (!m) throw new MoneyParseError(input, 'Malformed amount');
  const whole = m[1]!.replace(/,/g, '');
  const frac = (m[4] ?? '').padEnd(2, '0');
  const cents = Number(whole) * 100 + Number(frac);
  if (!Number.isSafeInteger(cents) || cents > MAX_CENTS) {
    throw new MoneyParseError(input, 'Amount out of range');
  }
  return negative ? -cents : cents;
}

export function formatCents(
  cents: number,
  opts: { blankZero?: boolean; parens?: boolean } = {},
): string {
  if (opts.blankZero && cents === 0) return '–';
  const negative = cents < 0;
  const abs = Math.abs(cents);
  const whole = Math.floor(abs / 100);
  const frac = String(abs % 100).padStart(2, '0');
  const body = `${whole.toLocaleString('en-US')}.${frac}`;
  if (!negative) return body;
  return opts.parens ? `(${body})` : `-${body}`;
}

/** Decimal string for CSV/XLSX export, e.g. "-1234.56". */
export function centsToDecimalString(cents: number): string {
  const negative = cents < 0;
  const abs = Math.abs(cents);
  return `${negative ? '-' : ''}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, '0')}`;
}

export function formatBps(bps: number): string {
  const whole = Math.floor(bps / 100);
  const frac = bps % 100;
  return frac === 0 ? `${whole}%` : `${whole}.${String(frac).padStart(2, '0').replace(/0$/, '')}%`;
}

/** Percentage with one decimal, round half up, e.g. 3680 → "36.8%" given num/den. */
export function formatPct1(numerator: number, denominator: number): string {
  if (denominator === 0) return '–';
  const tenths = roundHalfUpDiv(numerator * 1000, denominator);
  const sign = tenths < 0 ? '-' : '';
  const abs = Math.abs(tenths);
  return `${sign}${Math.floor(abs / 10)}.${abs % 10}%`;
}

/** Integer division with round-half-up (away from zero for positives). */
export function roundHalfUpDiv(numerator: number, denominator: number): number {
  if (denominator === 0) throw new Error('Division by zero');
  const neg = numerator < 0 !== denominator < 0;
  const n = Math.abs(numerator);
  const d = Math.abs(denominator);
  const q = Math.floor(n / d);
  const r = n % d;
  const rounded = r * 2 >= d ? q + 1 : q;
  return neg ? -rounded : rounded;
}
