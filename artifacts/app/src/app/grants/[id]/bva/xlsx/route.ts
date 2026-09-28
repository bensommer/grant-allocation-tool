import { xlsxResponse, xlsxTable } from '@/reports/table-export';
import { loadBvaExport } from '../export';

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const data = await loadBvaExport(req, id);
  if (!data) return new Response('Grant not found', { status: 404 });
  // Funder view is category rows only (see loadBvaExport), so SUM totals do not double-count.
  const buf = await xlsxTable(
    data.view === 'funder' ? { ...data.table, sumColumns: [1, 2, 3] } : data.table,
  );
  return xlsxResponse(buf, data.filename('xlsx'));
}
