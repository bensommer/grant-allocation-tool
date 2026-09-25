import { formatPct1 } from '@/domain/money';
import type { bvaData } from '@/services/bva';
import type { ExportTable } from './table-export';
import { grantMonths } from '@/app/grants/[id]/bva/months';

type Grant = Awaited<ReturnType<typeof bvaData>>['grants'][number];
type Data = Awaited<ReturnType<typeof bvaData>>;

export function grantBvaTable(
  grant: Grant,
  date: Date,
  label: string,
  run: Data['run'],
): ExportTable {
  const months = grantMonths(grant.startDate, grant.endDate, date);
  return {
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
  };
}

export function restrictedTable(
  grants: Data['grants'],
  date: Date,
  label: string,
  run: Data['run'],
): ExportTable {
  return {
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
        g.figures.remainingAwardCents,
        g.pace.flag,
        g.endDate.toISOString().slice(0, 10),
        String(Math.ceil((g.endDate.getTime() - date.getTime()) / 86_400_000)),
      ]),
    sumColumns: [1, 2, 3, 4, 5],
  };
}
