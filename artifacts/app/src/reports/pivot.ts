import type { Dimension } from './params';
import type { Fact } from './query';

export const cellId = (row: string, col: string) => JSON.stringify([row, col]);
const splitCellId = (key: string) => JSON.parse(key) as [string, string];
export function pivot(
  facts: Fact[],
  opts: { rows: Dimension; cols: Dimension; page?: Dimension; pageKey?: string; zeros?: boolean },
) {
  const filtered =
    opts.pageKey === undefined
      ? facts
      : facts.filter((f) => opts.page && f[opts.page] === opts.pageKey);
  const cells = new Map<string, number>(),
    rowTotals = new Map<string, number>(),
    colTotals = new Map<string, number>();
  let grandTotal = 0;
  for (const f of filtered) {
    const r = f[opts.rows],
      c = f[opts.cols],
      key = cellId(r, c);
    cells.set(key, (cells.get(key) ?? 0) + f.amountCents);
    rowTotals.set(r, (rowTotals.get(r) ?? 0) + f.amountCents);
    colTotals.set(c, (colTotals.get(c) ?? 0) + f.amountCents);
    grandTotal += f.amountCents;
  }
  const sort = (a: string, b: string) => a.localeCompare(b, undefined, { numeric: true });
  // Zero suppression hides a row/column only when every one of its cells is zero, so
  // offsetting entries (e.g. a bill and its credit) still reconcile to the visible totals.
  const nonZeroRows = new Set<string>();
  const nonZeroCols = new Set<string>();
  for (const [key, v] of cells) {
    if (v === 0) continue;
    const [r, c] = splitCellId(key);
    nonZeroRows.add(r);
    nonZeroCols.add(c);
  }
  const rowKeys = [...rowTotals.keys()].filter((k) => opts.zeros || nonZeroRows.has(k)).sort(sort);
  const colKeys = [...colTotals.keys()].filter((k) => opts.zeros || nonZeroCols.has(k)).sort(sort);
  return { rowKeys, colKeys, cells, rowTotals, colTotals, grandTotal };
}
