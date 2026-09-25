import { getOrgId } from '@/lib/org';
import { dimensionLabels, parseParams } from '@/reports/params';
import { loadReport } from '@/reports/query';
import { exportTables, sectionTitle } from '@/reports/export';
import { cellId } from '@/reports/pivot';
import { pdfDocument, pdfErrorResponse, pdfResponse, type PdfRowKind } from '@/reports/pdf';
import { budgetColumnsNote, displayLabel, type ReportView } from '@/reports/view';
import { formatPct1 } from '@/domain/money';
import type { TableCell } from '@/reports/table-export';

export async function GET(request: Request) {
  const url = new URL(request.url);
  const p = parseParams(url.searchParams);
  const { org, run, facts, budgets } = await loadReport(await getOrgId(), p);
  if (!run) return new Response('No current run', { status: 404 });
  const sections = exportTables(facts, p, budgets).map(({ section, block }) => {
    const { total, pageKey } = block;
    const numeric = (view: ReportView, cells: number[], actual: number, budget: number) => [
      ...cells,
      actual,
      ...(view.showBudget ? [budget, budget - actual, formatPct1(actual, budget)] : []),
    ];
    const rows: TableCell[][] = [];
    const rowKinds: PdfRowKind[] = [];
    const push = (kind: PdfRowKind, cells: TableCell[]) => {
      rows.push(cells);
      rowKinds.push(kind);
    };
    for (const group of block.groups) {
      const view = group.view;
      if (block.grouped) push('group', [group.heading!]);
      for (const row of view.rows)
        push('row', [
          displayLabel(view.label(p.rows, row)),
          ...numeric(
            total,
            total.cols.map((col) => view.data.cells.get(cellId(row, col)) ?? 0),
            view.actualFor(row),
            view.budgetFor(row),
          ),
        ]);
      if (block.grouped)
        push('subtotal', [
          'Subtotal',
          ...numeric(
            total,
            total.cols.map((col) => view.columnTotal(col)),
            view.actualTotal,
            view.budgetTotal,
          ),
        ]);
    }
    const title = sectionTitle(section, p);
    return {
      heading:
        pageKey === undefined
          ? title
          : `${title} · ${dimensionLabels[p.page!]}: ${displayLabel(total.label(p.page!, pageKey))}`,
      table: {
        title: 'Report',
        parameters: {},
        headers: [
          dimensionLabels[p.rows],
          ...total.cols.map((col) => displayLabel(total.label(p.cols, col))),
          'Total',
          ...(total.showBudget ? ['Budget', 'Remaining', 'Used (%)'] : []),
        ],
        rows,
        rowKinds,
        totals: [
          'Total',
          ...numeric(
            total,
            total.cols.map((col) => total.columnTotal(col)),
            total.actualTotal,
            total.budgetTotal,
          ),
        ],
      },
    };
  });
  try {
    const buf = await pdfDocument({
      title: org.name,
      subtitle: `${dimensionLabels[p.rows]} × ${dimensionLabels[p.cols]}`,
      parameters: {
        Period: `${p.from ?? 'All'} – ${p.to ?? 'All'}`,
        Run: run.id,
        ...(p.grant.length ? { Grant: p.grant.join(', ') } : {}),
        ...(p.program.length ? { Program: p.program.join(', ') } : {}),
        ...(budgetColumnsNote(p)
          ? { Budget: 'Budget columns are shown when the report is broken by grant or not at all' }
          : {}),
      },
      sections,
    });
    return pdfResponse(buf, 'report.pdf');
  } catch (error) {
    return pdfErrorResponse(error);
  }
}
