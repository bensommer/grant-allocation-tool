import Link from 'next/link';
import { PageHeader } from '@/components/page-header';
import { formatCents } from '@/domain/money';
import { getOrgId } from '@/lib/org';
import { bvaData, reportDate } from '@/services/bva';

export const dynamic = 'force-dynamic';

export default async function RestrictedPage({
  searchParams,
}: {
  searchParams: Promise<{ asOf?: string; sort?: string; dir?: string }>;
}) {
  const query = await searchParams;
  const { date, label } = reportDate(query.asOf);
  const { run, grants } = await bvaData(await getOrgId(), date);
  const rows = grants.filter((g) => g.restrictionType !== 'unrestricted');
  const sort = [
    'name',
    'award',
    'received',
    'spent',
    'balance',
    'remaining',
    'pacing',
    'end',
    'days',
  ].includes(query.sort ?? '')
    ? query.sort!
    : 'name';
  const dir = query.dir === 'desc' ? 'desc' : 'asc';
  const days = (end: Date) => Math.ceil((end.getTime() - date.getTime()) / 86_400_000);
  const value = (g: (typeof rows)[number], key: string): string | number =>
    key === 'name'
      ? g.name
      : key === 'award'
        ? g.awardAmountCents
        : key === 'received'
          ? g.received
          : key === 'spent'
            ? g.actual
            : key === 'balance'
              ? g.balance
              : key === 'remaining'
                ? g.awardAmountCents - g.actual
                : key === 'pacing'
                  ? g.pace.flag
                  : key === 'end'
                    ? g.endDate.getTime()
                    : days(g.endDate);
  rows.sort((a, b) => {
    const x = value(a, sort),
      y = value(b, sort);
    return (
      (typeof x === 'number' && typeof y === 'number'
        ? x - y
        : String(x).localeCompare(String(y))) * (dir === 'asc' ? 1 : -1)
    );
  });
  return (
    <>
      <PageHeader
        title="Restricted funds"
        subtitle={`As of ${label} · Current run: ${run ? (run.finishedAt ?? run.startedAt).toISOString().replace('T', ' ').slice(0, 19) + ' UTC' : 'none'}`}
        actions={
          <>
            <Link className="btn btn-secondary btn-sm" href={`/restricted/csv?asOf=${label}`}>
              CSV
            </Link>
            <Link className="btn btn-secondary btn-sm" href={`/restricted/xlsx?asOf=${label}`}>
              XLSX
            </Link>
            <Link className="btn btn-secondary btn-sm" href={`/restricted/pdf?asOf=${label}`}>
              PDF
            </Link>
          </>
        }
      />
      {run?.stale && (
        <div className="banner banner-warn">
          Configuration changed since the current run. Reports show numbers from{' '}
          {(run.finishedAt ?? run.startedAt).toISOString().replace('T', ' ').slice(0, 19)} UTC until
          you recompute.
        </div>
      )}
      {!run && (
        <div className="banner banner-warn">
          No current run — recompute on <Link href="/runs">/runs</Link>.
        </div>
      )}
      <form method="get" className="mb-4">
        <label>
          As of <input name="asOf" type="date" defaultValue={label} />
        </label>{' '}
        <button className="btn btn-secondary">Apply</button>
      </form>
      <div className="card overflow-x-auto">
        <table>
          <thead>
            <tr>
              {[
                ['name', 'Grant'],
                ['award', 'Award'],
                ['received', 'Received'],
                ['spent', 'Spent'],
                ['balance', 'Restricted balance'],
                ['remaining', 'Remaining award'],
                ['pacing', 'Pacing'],
                ['end', 'End date'],
                ['days', 'Days remaining'],
              ].map(([key, title]) => (
                <th key={key}>
                  <Link
                    href={`/restricted?asOf=${label}&sort=${key}&dir=${sort === key && dir === 'asc' ? 'desc' : 'asc'}`}
                  >
                    {title}
                  </Link>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((g) => (
              <tr key={g.id}>
                <td>
                  <Link href={`/grants/${g.id}/bva?asOf=${label}`}>{g.name}</Link>
                </td>
                <td className="num">{formatCents(g.awardAmountCents)}</td>
                <td className="num">{formatCents(g.received)}</td>
                <td className="num">{formatCents(g.actual)}</td>
                <td className="num">
                  {formatCents(g.balance)}{' '}
                  {g.balance < 0 && <span className="pill pill-warn">spent ahead of receipts</span>}
                </td>
                <td className="num">{formatCents(g.awardAmountCents - g.actual)}</td>
                <td>
                  <span className={`pill ${g.flagged ? 'pill-warn' : 'pill-ok'}`}>
                    {g.pace.flag}
                    {g.rows.some((r) => r.overBudget) ? ' · over-budget line' : ''}
                  </span>
                </td>
                <td>{g.endDate.toISOString().slice(0, 10)}</td>
                <td className="num">{days(g.endDate)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="muted mt-4 text-sm">
        Received: matched income source lines in the grant period through as-of. Spent: current-run
        expense allocations to budget lines. Restricted balance = received − spent; remaining award
        = award − spent. Pacing compares spend to straight-line expected award through as-of
        (inclusive days).
      </p>
    </>
  );
}
