import type { Dimension } from './params';
import type { Fact } from './query';

export const cellId = (row: string, col: string) => JSON.stringify([row, col]);
const splitCellId = (key: string) => JSON.parse(key) as [string, string];

const categoryRank: Record<string, number> = { program: 0, management_general: 1, fundraising: 2 };
const placeholderKeys = new Set(['Unmapped', 'Unassigned']);
/**
 * Axis order for a dimension: program services first, then Management & General, then
 * Fundraising; "Unmapped"/"Unassigned" placeholders last; numeric-aware alphabetical otherwise.
 */
export function axisOrder(
  dimension: Dimension,
  meta: Map<string, { functionalCategory?: string }>,
): (a: string, b: string) => number {
  const rank = (key: string) => {
    if (placeholderKeys.has(key)) return 10;
    if (dimension === 'program') return categoryRank[meta.get(key)?.functionalCategory ?? ''] ?? 3;
    if (dimension === 'functionalCategory') return categoryRank[key] ?? 3;
    return 0;
  };
  return (a, b) => rank(a) - rank(b) || a.localeCompare(b, undefined, { numeric: true });
}
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
  const rowLabels = new Map<string, { name: string; code?: string; functionalCategory?: string }>();
  const colLabels = new Map<string, { name: string; code?: string; functionalCategory?: string }>();
  let grandTotal = 0;
  for (const f of filtered) {
    const r = f[opts.rows],
      c = f[opts.cols],
      key = cellId(r, c);
    rowLabels.set(r, {
      name: f.labels?.[opts.rows] ?? r,
      code: f.secondary?.[opts.rows],
      functionalCategory: f.functionalCategory,
    });
    colLabels.set(c, {
      name: f.labels?.[opts.cols] ?? c,
      code: f.secondary?.[opts.cols],
      functionalCategory: f.functionalCategory,
    });
    cells.set(key, (cells.get(key) ?? 0) + f.amountCents);
    rowTotals.set(r, (rowTotals.get(r) ?? 0) + f.amountCents);
    colTotals.set(c, (colTotals.get(c) ?? 0) + f.amountCents);
    grandTotal += f.amountCents;
  }
  const sort = axisOrder(opts.rows, rowLabels);
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
  const order = new Map(filtered.map((f) => [f[opts.rows], f.budgetSortOrder]));
  const rowKeys = [...rowTotals.keys()]
    .filter((k) => opts.zeros || nonZeroRows.has(k))
    .sort(
      opts.rows === 'grantBudgetLine'
        ? (a, b) => (order.get(a) ?? 999999) - (order.get(b) ?? 999999) || sort(a, b)
        : sort,
    );
  const colKeys = [...colTotals.keys()]
    .filter((k) => opts.zeros || nonZeroCols.has(k))
    .sort(axisOrder(opts.cols, colLabels));
  return { rowKeys, colKeys, cells, rowTotals, colTotals, grandTotal, rowLabels, colLabels };
}
