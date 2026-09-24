import { getOrgId } from '@/lib/org';
import { parseParams } from '@/reports/params';
import { loadReport } from '@/reports/query';
import { pdfOfPage } from '@/reports/table-export';

export async function GET(request: Request) {
  const url = new URL(request.url);
  const p = parseParams(url.searchParams);
  const { run } = await loadReport(await getOrgId(), p);
  if (!run) return new Response('No current run', { status: 404 });
  // Pin the run so the print page renders exactly what the caller saw.
  const q = new URLSearchParams(url.searchParams);
  q.set('run', run.id);
  return pdfOfPage('/reports/print', q, 'report.pdf');
}
