import { getOrgId } from '@/lib/org';
import { parseParams } from '@/reports/params';
import { loadReport } from '@/reports/query';
import { csvReport } from '@/reports/export';
export async function GET(request: Request) {
  const p = parseParams(new URL(request.url).searchParams);
  const { run, facts, budgets } = await loadReport(await getOrgId(), p);
  if (!run) return new Response('No current run', { status: 404 });
  return new Response(csvReport(facts, p, budgets), {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': 'attachment; filename="report.csv"',
    },
  });
}
