import type { Dimension } from './params';
import type { Fact } from './query';

export const cellId = (row: string, col: string) => JSON.stringify([row, col]);
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
  const rowKeys = [...rowTotals.keys()]
    .filter((k) => opts.zeros || rowTotals.get(k) !== 0)
    .sort(sort);
  const colKeys = [...colTotals.keys()]
    .filter((k) => opts.zeros || colTotals.get(k) !== 0)
    .sort(sort);
  return { rowKeys, colKeys, cells, rowTotals, colTotals, grandTotal };
}
