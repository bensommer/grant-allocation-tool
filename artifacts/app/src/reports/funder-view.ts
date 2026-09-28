/**
 * Funder view export (JPH-23): one row per funder category with its working
 * lines beneath, budget / charged / remaining, in the funder's own headings.
 */
import { toISODate } from '@/domain/dates';
import type { BudgetTree } from '@/services/grant-budget';
import type { PdfTable } from './pdf';
import { xlsxTable, type TableCell } from './table-export';

export const FUNDER_VIEW_HEADERS = ['Category / line', 'Budget', 'Charged', 'Remaining', 'Used'];

export function funderViewTable(
  grant: { name: string; funder: string },
  tree: BudgetTree,
  asOf: Date,
): PdfTable {
  const rows: TableCell[][] = [];
  const rowKinds: PdfTable['rowKinds'] = [];
  const used = (charged: number, budget: number) =>
    budget > 0 ? `${Math.round((charged / budget) * 100)}%` : '—';
  for (const c of tree.categories) {
    rows.push([
      c.name,
      c.currentCents,
      c.chargedCents,
      c.currentCents - c.chargedCents,
      used(c.chargedCents, c.currentCents),
    ]);
    rowKinds.push('group');
    for (const l of c.children) {
      rows.push([
        `  ${l.name}`,
        l.currentCents,
        l.chargedCents,
        l.currentCents - l.chargedCents,
        used(l.chargedCents, l.currentCents),
      ]);
      rowKinds.push('row');
    }
  }
  for (const l of tree.loose) {
    rows.push([
      l.name,
      l.currentCents,
      l.chargedCents,
      l.currentCents - l.chargedCents,
      used(l.chargedCents, l.currentCents),
    ]);
    rowKinds.push('row');
  }
  const budget = tree.totals.budgetCents;
  const charged = tree.totals.chargedCents;
  return {
    title: `Funder view — ${grant.name}`,
    parameters: {
      Grant: grant.name,
      Funder: grant.funder,
      'As of': toISODate(asOf),
      'Compute run': tree.runId ?? 'none',
    },
    headers: FUNDER_VIEW_HEADERS,
    rows,
    rowKinds,
    colAlign: ['left', 'right', 'right', 'right', 'right'],
    totals: ['Total', budget, charged, budget - charged, used(charged, budget)],
  };
}

/**
 * What "Funder view (budget as awarded)" shows on the page (JPH-29 E2): the funder categories
 * only, no working lines beneath them, so a SUM over any column equals the totals row. A grant
 * with no funder categories keeps its (loose) lines — the page shows the same table under both
 * views in that case.
 */
export function funderCategoriesTable(
  grant: { name: string; funder: string },
  tree: BudgetTree,
  asOf: Date,
): PdfTable {
  const table = funderViewTable(grant, tree, asOf);
  if (tree.categories.length === 0) return table;
  const keep = table.rows.map((_, i) => table.rowKinds?.[i] !== 'row');
  return {
    ...table,
    headers: ['Category', ...table.headers.slice(1)],
    rows: table.rows.filter((_, i) => keep[i]),
    rowKinds: table.rowKinds?.filter((_, i) => keep[i]),
  };
}

/** Category rows only (working lines would double-count under a SUM). */
export async function funderViewXlsx(
  grant: { name: string; funder: string },
  tree: BudgetTree,
  asOf: Date,
): Promise<Buffer> {
  return xlsxTable({ ...funderCategoriesTable(grant, tree, asOf), sumColumns: [1, 2, 3] });
}
