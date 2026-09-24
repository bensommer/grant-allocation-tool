import { getOrgId } from '@/lib/org';
import { bvaData, reportDate } from '@/services/bva';
import { xlsxResponse, xlsxTable } from '@/reports/table-export';

export async function GET(req: Request) {
  const { date, label } = reportDate(new URL(req.url).searchParams.get('asOf') ?? undefined);
  const { run, grants } = await bvaData(await getOrgId(), date);
  const buf = await xlsxTable({
    title: 'Restricted balances',
    parameters: { 'As of': label, Run: run?.id ?? 'none' },
    headers: [
      'Grant',
      'Award',
      'Received',
      'Spent',
      'Restricted balance',
      'Remaining award',
      'Pacing',
      'End date',
      'Days remaining',
    ],
    rows: grants
      .filter((g) => g.restrictionType !== 'unrestricted')
      .map((g) => [
        g.name,
        g.awardAmountCents,
        g.received,
        g.actual,
        g.balance,
        g.awardAmountCents - g.actual,
        g.pace.flag,
        g.endDate.toISOString().slice(0, 10),
        String(Math.ceil((g.endDate.getTime() - date.getTime()) / 86_400_000)),
      ]),
    sumColumns: [1, 2, 3, 4, 5],
  });
  return xlsxResponse(buf, `restricted-${label}.xlsx`);
}
