import { getOrgId } from '@/lib/org';
import { dimensionLabels, parseParams } from '@/reports/params';
import { loadReport } from '@/reports/query';
import { exportViews } from '@/reports/export';
import { cellId } from '@/reports/pivot';
import { pdfDocument, pdfErrorResponse, pdfResponse } from '@/reports/pdf';
import { budgetColumnsNote, displayLabel } from '@/reports/view';
import { formatPct1 } from '@/domain/money';

export async function GET(request: Request) {
  const url = new URL(request.url);
  const p = parseParams(url.searchParams);
  const { org, run, facts, budgets } = await loadReport(await getOrgId(), p);
  if (!run) return new Response('No current run', { status: 404 });
  const sections = exportViews(facts, p, budgets).map(({ section, pageKey, view }) => {
    return {
      heading: `${section}${pageKey === undefined ? '' : ` · ${dimensionLabels[p.page!]}: ${displayLabel(view.label(p.page!, pageKey))}`}`,
      table: {
        title: 'Report',
        parameters: {},
        headers: [
          dimensionLabels[p.rows],
          ...view.cols.map((col) => displayLabel(view.label(p.cols, col))),
          'Total',
          ...(view.showBudget ? ['Budget', 'Remaining', 'Used (%)'] : []),
        ],
        rows: view.rows.map((row) => [
          displayLabel(view.label(p.rows, row)),
          ...view.cols.map((col) => view.data.cells.get(cellId(row, col)) ?? 0),
          view.actualFor(row),
          ...(view.showBudget
            ? [
                view.budgetFor(row),
                view.budgetFor(row) - view.actualFor(row),
                formatPct1(view.actualFor(row), view.budgetFor(row)),
              ]
            : []),
        ]),
        sumColumns: view.cols
          .map((_, i) => i + 1)
          .concat(
            view.cols.length + 1,
            ...(view.showBudget ? [view.cols.length + 2, view.cols.length + 3] : []),
          ),
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
