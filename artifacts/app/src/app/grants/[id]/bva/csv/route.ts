import { getOrgId } from '@/lib/org';
import { bvaData, reportDate } from '@/services/bva';
import { centsToDecimalString, formatPct1 } from '@/domain/money';
import { grantMonths } from '../months';

const csv = (cells: (string | number)[]) =>
  cells.map((x) => `"${String(x).replaceAll('"', '""')}"`).join(',');

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { date, label } = reportDate(new URL(req.url).searchParams.get('asOf') ?? undefined);
  const { run, grants } = await bvaData(await getOrgId(), date, id);
  const grant = grants[0];
  if (!grant) return new Response('Grant not found', { status: 404 });
  const months = grantMonths(grant.startDate, grant.endDate, date);
  const lines = [
    csv(['Grant', grant.name, 'As of', label, 'Run', run?.id ?? 'none']),
    csv(['Code', 'Budget line', 'Budget', 'Actual', 'Remaining', '% used', ...months]),
    ...grant.rows.map((r) =>
      csv([
        r.code,
        r.name,
        centsToDecimalString(r.budgetCents),
        centsToDecimalString(r.actual),
        centsToDecimalString(r.remaining),
        formatPct1(r.actual, r.budgetCents),
        ...months.map((m) => centsToDecimalString(r.monthly[m] ?? 0)),
      ]),
    ),
    csv([
      'Total',
      '',
      centsToDecimalString(grant.budget),
      centsToDecimalString(grant.actual),
      centsToDecimalString(grant.remaining),
      formatPct1(grant.actual, grant.budget),
      ...months.map((m) =>
        centsToDecimalString(grant.rows.reduce((n, r) => n + (r.monthly[m] ?? 0), 0)),
      ),
    ]),
  ];
  return new Response(lines.join('\r\n') + '\r\n', {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="bva-${label}.csv"`,
    },
  });
}
