import { getOrgId } from '@/lib/org';
import { parseParams } from '@/reports/params';
import { loadReport } from '@/reports/query';
import { xlsxReport } from '@/reports/export';
export async function GET(request: Request) {
  const p = parseParams(new URL(request.url).searchParams);
  const { run, facts, budgets } = await loadReport(await getOrgId(), p);
  if (!run) return new Response('No current run', { status: 404 });
  const buffer = await xlsxReport(facts, p, run.id, budgets);
  return new Response(new Uint8Array(buffer), {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': 'attachment; filename="report.xlsx"',
    },
  });
}
