import { describe, expect, it } from 'vitest';
import { contentHash, normalizeSource } from './import-service';

describe('source content hash', () => {
  it('normalizes whitespace, dates, key order, and formatted cents', () => {
    const a = { date: new Date('2026-02-14T00:00:00Z'), memo: ' food ', amount: '1,850.25' };
    const b = { amount: '1850.250', memo: 'food', date: '2026-02-14' };
    expect(normalizeSource(a)).toEqual({ date: '2026-02-14', memo: 'food', amount: 185025 });
    expect(contentHash(a)).toBe(contentHash(b));
    expect(contentHash(a)).not.toBe(contentHash({ ...b, amount: '1950.25' }));
  });
});
