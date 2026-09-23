import { describe, expect, it } from 'vitest';
import { formatCents, formatPct1, parseMoneyToCents, roundHalfUpDiv } from './money';

describe('parseMoneyToCents', () => {
  it.each([
    ['1234.56', 123456],
    ['$1,234.56', 123456],
    ['(1,234.56)', -123456],
    ['$0.10', 10],
    ['7', 700],
    ['-12.5', -1250],
    ['0', 0],
    [' 600.01 ', 60001],
    ['18,300.50', 1830050],
  ])('parses %s → %d', (input, expected) => {
    expect(parseMoneyToCents(input)).toBe(expected);
  });

  it.each([['1e3'], ['12,3.45'], ['abc'], [''], ['1.234'], ['1,23'], ['$']])(
    'rejects %s',
    (input) => {
      expect(() => parseMoneyToCents(input)).toThrow();
    },
  );
});

describe('formatCents', () => {
  it('formats with thousands and two decimals', () => {
    expect(formatCents(7711861)).toBe('77,118.61');
    expect(formatCents(-100)).toBe('-1.00');
    expect(formatCents(-100, { parens: true })).toBe('(1.00)');
    expect(formatCents(0, { blankZero: true })).toBe('–');
  });
});

describe('formatPct1 / roundHalfUpDiv', () => {
  it('rounds half up to one decimal', () => {
    expect(formatPct1(2648190, 7200000)).toBe('36.8%');
    expect(formatPct1(1808520, 3600000)).toBe('50.2%');
    expect(formatPct1(3975291, 12000000)).toBe('33.1%');
    expect(roundHalfUpDiv(5, 2)).toBe(3);
    expect(roundHalfUpDiv(-5, 2)).toBe(-3);
  });
});
