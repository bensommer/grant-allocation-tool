import { describe, expect, it } from 'vitest';
import { formatPct1 } from './money';
import {
  formatDate,
  formatDateTime,
  formatMoney,
  formatMonth,
  formatPct,
  formatPeriod,
} from './format';

describe('formatMoney', () => {
  it.each([
    [123456, '1,234.56'],
    [-123456, '(1,234.56)'],
    [1, '0.01'],
    [-1, '(0.01)'],
    [2147483647, '21,474,836.47'],
    [0, '—'],
    [0.49, '—'],
    [0.5, '0.01'],
    [-0.5, '(0.01)'],
    [100.5, '1.01'],
    [-100.5, '(1.01)'],
  ])('%s → %s', (cents, expected) => expect(formatMoney(cents)).toBe(expected));
  it('shows dollars and optional zero', () => {
    expect(formatMoney(-123456, { dollar: true })).toBe('($1,234.56)');
    expect(formatMoney(0, { dollar: true, zero: 'zero' })).toBe('$0.00');
    expect(() => formatMoney(Infinity)).toThrow();
  });
});

describe('UTC dates', () => {
  it('collapses a shared year', () => {
    expect(formatPeriod(new Date('2026-01-01T00:00:00Z'), new Date('2026-12-31T00:00:00Z'))).toBe(
      'Jan 1 – Dec 31, 2026',
    );
  });
  it('keeps different years', () => {
    expect(formatPeriod(new Date('2025-12-01T00:00:00Z'), new Date('2026-03-31T00:00:00Z'))).toBe(
      'Dec 1, 2025 – Mar 31, 2026',
    );
  });
  it('formats timestamps in UTC', () => {
    expect(formatDate(new Date('2026-03-31T23:59:00Z'))).toBe('Mar 31, 2026');
    expect(formatDateTime(new Date('2026-09-24T01:00:00Z'))).toBe('Sep 24, 2026, 01:00 UTC');
  });
});

describe('formatMonth', () => {
  it('shows year only when needed', () => {
    expect(formatMonth('2026-01')).toBe('Jan');
    expect(formatMonth('2026-01', {}, ['2026-01', '2026-12'])).toBe('Jan');
    expect(formatMonth('2026-01', {}, ['2025-12', '2026-01'])).toBe('Jan 2026');
    expect(formatMonth('2026-01', { year: 'always' })).toBe('Jan 2026');
    expect(formatMonth('2026-01', { year: 'never' }, ['2025-12'])).toBe('Jan');
    expect(() => formatMonth('2026-13')).toThrow();
  });
});

describe('formatPct (basis points)', () => {
  it.each([
    [0, '0.0%'],
    [3420, '34.2%'],
    [10000, '100.0%'],
    [-12345, '-123.5%'],
    [5, '0.1%'],
    [-5, '-0.1%'],
    [4, '0.0%'],
    [999995, '10000.0%'],
  ])('%s → %s', (bps, expected) => expect(formatPct(bps)).toBe(expected));
  it('is compatible with ratio formatter at exact tenths', () => {
    expect(formatPct(3680)).toBe(formatPct1(368, 1000));
  });
});
