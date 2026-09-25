import { entryCsv } from '@/reports/correcting-entry';
import { loadEntryExport } from '../load';

/** QuickBooks Online journal-entry import CSV (format documented in src/reports/correcting-entry.ts). */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string; code: string }> },
) {
  const { id, code } = await params;
  const entry = await loadEntryExport(id, code);
  if (!entry) return new Response('Correcting entry not found', { status: 404 });
  return new Response(entryCsv(entry), {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${entry.code}.csv"`,
    },
  });
}
