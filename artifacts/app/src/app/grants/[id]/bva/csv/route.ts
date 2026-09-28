import { centsToDecimalString } from '@/domain/money';
import { loadBvaExport } from '../export';

const csv = (cells: (string | number | null | undefined)[]) =>
  cells
    .map((x) => (typeof x === 'number' ? centsToDecimalString(x) : String(x ?? '')))
    .map((x) => `"${x.replaceAll('"', '""')}"`)
    .join(',');

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const data = await loadBvaExport(req, id);
  if (!data) return new Response('Grant not found', { status: 404 });
  const { table } = data;
  const lines = [
    csv(Object.entries(table.parameters ?? {}).flat()),
    csv(table.headers),
    ...table.rows.map((r) => csv(r.map((c) => (typeof c === 'string' ? c.trim() : c)))),
    ...(table.totals ? [csv(table.totals)] : []),
  ];
  return new Response(lines.join('\r\n') + '\r\n', {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${data.filename('csv')}"`,
    },
  });
}
