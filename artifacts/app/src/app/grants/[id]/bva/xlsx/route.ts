import { getOrgId } from '@/lib/org';
import { bvaData, reportDate } from '@/services/bva';
import { formatPct1 } from '@/domain/money';
import { xlsxResponse, xlsxTable } from '@/reports/table-export';
import { grantMonths } from '../months';

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { date, label } = reportDate(new URL(req.url).searchParams.get('asOf') ?? undefined);
  const { run, grants } = await bvaData(await getOrgId(), date, id);
  const grant = grants[0];
  if (!grant) return new Response('Grant not found', { status: 404 });
  const months = grantMonths(grant.startDate, grant.endDate, date);
  const buf = await xlsxTable({
    title: 'Budget vs actual',
    parameters: { Grant: grant.name, 'As of': label, Run: run?.id ?? 'none' },
    headers: ['Code', 'Budget line', 'Budget', 'Actual', 'Remaining', '% used', ...months],
    rows: grant.rows.map((r) => [
      r.code,
      r.name,
      r.budgetCents,
      r.actual,
      r.remaining,
      formatPct1(r.actual, r.budgetCents),
      ...months.map((m) => r.monthly[m] ?? 0),
    ]),
    sumColumns: [2, 3, 4, ...months.map((_, i) => 6 + i)],
  });
  return xlsxResponse(buf, `bva-${grant.awardNumber ?? grant.name}-${label}.xlsx`);
}
