import { describe, expect, it } from 'vitest';
import { utcDate } from './dates';
import { AS_OF_COOKIE, defaultRange, fiscalYearStart, resolveAsOf } from './period';

const books = utcDate(2026, 3, 31);
const org = { fiscalYearStartMonth: 1, booksThrough: books };

describe('resolveAsOf (JPH-25 A1)', () => {
  it('prefers ?asOf, then the cookie, then books-through', () => {
    expect(resolveAsOf({ asOf: '2026-02-28' }, { [AS_OF_COOKIE]: '2026-01-15' }, org)).toEqual({
      date: utcDate(2026, 2, 28),
      label: '2026-02-28',
      source: 'query',
    });
    expect(resolveAsOf({}, { [AS_OF_COOKIE]: '2026-01-15' }, org)).toEqual({
      date: utcDate(2026, 1, 15),
      label: '2026-01-15',
      source: 'cookie',
    });
    expect(resolveAsOf({}, {}, org)).toEqual({ date: books, label: '2026-03-31', source: 'books' });
  });

  it('accepts a Next cookie store and URLSearchParams', () => {
    const jar = {
      get: (name: string) => (name === AS_OF_COOKIE ? { value: '2026-02-01' } : undefined),
    };
    expect(resolveAsOf(new URLSearchParams(''), jar, org).label).toBe('2026-02-01');
    expect(resolveAsOf(new URLSearchParams('asOf=2026-03-01'), jar, org).label).toBe('2026-03-01');
  });

  it('rejects a malformed ?asOf but ignores a malformed cookie', () => {
    expect(() => resolveAsOf({ asOf: '2026-02-30' }, {}, org)).toThrow(/Invalid as-of/);
    expect(() => resolveAsOf({ asOf: 'yesterday' }, {}, org)).toThrow(/Invalid as-of/);
    expect(resolveAsOf({}, { [AS_OF_COOKIE]: 'nope' }, org).source).toBe('books');
  });

  it('falls back to today (UTC) before the first import', () => {
    const r = resolveAsOf({}, {}, { fiscalYearStartMonth: 1, booksThrough: null });
    expect(r.source).toBe('today');
    expect(r.label).toBe(new Date().toISOString().slice(0, 10));
  });
});

describe('defaultRange', () => {
  it('runs from the fiscal year start to as-of', () => {
    expect(defaultRange(books, org)).toEqual({ from: utcDate(2026, 1, 1), to: books });
  });

  it('respects a July fiscal year on both sides of the boundary', () => {
    const july = { fiscalYearStartMonth: 7 };
    expect(fiscalYearStart(utcDate(2026, 3, 31), july)).toEqual(utcDate(2025, 7, 1));
    expect(fiscalYearStart(utcDate(2026, 7, 1), july)).toEqual(utcDate(2026, 7, 1));
    expect(fiscalYearStart(utcDate(2026, 12, 31), july)).toEqual(utcDate(2026, 7, 1));
  });
});
