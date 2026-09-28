/**
 * Shared loader for the Budget vs. Actuals exports (JPH-29 E2). Funder view exports exactly
 * what the page shows — the funder categories, no working lines beneath them; Internal view
 * exports the working lines by month (the original BvA table). The filename carries the view.
 */
import { getOrgId } from '@/lib/org';
import { grantBvaTable } from '@/reports/bva-table';
import { funderCategoriesTable } from '@/reports/funder-view';
import type { PdfTable } from '@/reports/pdf';
import { bvaData, reportDate } from '@/services/bva';
import { budgetTree } from '@/services/grant-budget';
import { grantHeader } from '@/services/grant-workspace';
import { bvaFilename, bvaView, type BvaView } from './view';

export interface BvaExport {
  view: BvaView;
  label: string;
  date: Date;
  table: PdfTable;
  grant: { name: string; funder: string };
  filename: (ext: string) => string;
}

export async function loadBvaExport(req: Request, id: string): Promise<BvaExport | null> {
  const url = new URL(req.url);
  const view = bvaView(url.searchParams.get('view') ?? undefined);
  const { date, label } = reportDate(url.searchParams.get('asOf') ?? undefined);
  const orgId = await getOrgId();
  const [{ run, grants }, header] = await Promise.all([
    bvaData(orgId, date, id),
    grantHeader(orgId, id),
  ]);
  const grant = grants[0];
  if (!grant || !header) return null;
  const table =
    view === 'funder'
      ? funderCategoriesTable(header, await budgetTree(orgId, id, date), date)
      : grantBvaTable(grant, date, label, run);
  return {
    view,
    label,
    date,
    table,
    grant: header,
    filename: (ext) => bvaFilename(view, label, ext),
  };
}
