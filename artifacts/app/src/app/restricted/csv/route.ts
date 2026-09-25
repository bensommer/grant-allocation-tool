import { getOrgId } from '@/lib/org';
import { bvaData, reportDate } from '@/services/bva';
import { centsToDecimalString } from '@/domain/money';

const csv = (cells: (string | number)[]) =>
  cells.map((x) => `"${String(x).replaceAll('"', '""')}"`).join(',');
export async function GET(req: Request) {
  const { date, label } = reportDate(new URL(req.url).searchParams.get('asOf') ?? undefined);
  const { run, grants } = await bvaData(await getOrgId(), date);
  const lines = [
    csv(['As of', label, 'Run', run?.id ?? 'none']),
    csv([
      'Grant',
      'Award',
      'Received',
      'Spent',
      'Restricted balance',
      'Remaining award',
      'Pacing',
      'End date',
      'Days remaining',
    ]),
    ...grants
      .filter((g) => g.restrictionType !== 'unrestricted')
      .map((g) =>
        csv([
          g.name,
          centsToDecimalString(g.awardAmountCents),
          centsToDecimalString(g.received),
          centsToDecimalString(g.actual),
          centsToDecimalString(g.balance),
          centsToDecimalString(g.figures.remainingAwardCents),
          g.pace.flag,
          g.endDate.toISOString().slice(0, 10),
          Math.ceil((g.endDate.getTime() - date.getTime()) / 86_400_000),
        ]),
      ),
  ];
  return new Response(lines.join('\r\n') + '\r\n', {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="restricted-${label}.csv"`,
    },
  });
}
