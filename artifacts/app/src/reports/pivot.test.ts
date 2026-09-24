import { describe, expect, it } from 'vitest';
import { cellId, pivot } from './pivot';
import type { Fact } from './query';
const facts = [
  { program: 'CT', glAccount: '6010 Wages', grant: 'A', amountCents: 100 },
  { program: 'CT', glAccount: '6020 Tax', grant: 'B', amountCents: 200 },
  { program: 'YM', glAccount: '6010 Wages', grant: 'A', amountCents: 300 },
  { program: 'ZERO', glAccount: '6010 Wages', grant: 'A', amountCents: 100 },
  { program: 'ZERO', glAccount: '6010 Wages', grant: 'A', amountCents: -100 },
] as Fact[];
describe('pivot', () => {
  it('aggregates 2 dimensions, stable numeric sort, totals and zero suppression', () => {
    const x = pivot(facts, { rows: 'program', cols: 'glAccount' });
    expect(x.rowKeys).toEqual(['CT', 'YM']);
    expect(x.colKeys).toEqual(['6010 Wages', '6020 Tax']);
    expect(x.cells.get(cellId('CT', '6010 Wages'))).toBe(100);
    expect(x.rowTotals.get('CT')).toBe(300);
    expect(x.colTotals.get('6010 Wages')).toBe(400);
    expect(x.grandTotal).toBe(600);
    expect(pivot(facts, { rows: 'program', cols: 'glAccount', zeros: true }).rowKeys).toContain(
      'ZERO',
    );
  });
  it('keeps rows whose cells offset to zero so visible cells reconcile to totals', () => {
    const offset = [
      { program: 'CT', glAccount: '6010', grant: 'A', amountCents: 100 },
      { program: 'CT', glAccount: '6020', grant: 'A', amountCents: -100 },
    ] as Fact[];
    const t = pivot(offset, { rows: 'program', cols: 'glAccount', zeros: false });
    expect(t.rowKeys).toEqual(['CT']);
    expect(t.colKeys).toEqual(['6010', '6020']);
    expect(t.rowTotals.get('CT')).toBe(0);
    // A row that is zero in every cell is still suppressed.
    const u = pivot(
      [...offset, { program: 'Z', glAccount: '6010', grant: 'A', amountCents: 0 }] as Fact[],
      { rows: 'program', cols: 'glAccount', zeros: false },
    );
    expect(u.rowKeys).toEqual(['CT']);
  });
  it('page-breaks on a third dimension', () => {
    const x = pivot(facts, { rows: 'program', cols: 'glAccount', page: 'grant', pageKey: 'B' });
    expect(x.grandTotal).toBe(200);
    expect(x.rowKeys).toEqual(['CT']);
  });
});
