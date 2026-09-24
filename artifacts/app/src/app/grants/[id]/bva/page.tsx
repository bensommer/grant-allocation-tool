import Link from 'next/link';
import { notFound } from 'next/navigation';
import { PageHeader } from '@/components/page-header';
import { formatCents, formatPct1 } from '@/domain/money';
import { getOrgId } from '@/lib/org';
import { bvaData, reportDate } from '@/services/bva';

export const dynamic = 'force-dynamic';

export default async function BvaPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ asOf?: string }>;
}) {
  const { id } = await params;
  const { date, label } = reportDate((await searchParams).asOf);
  const { run, grants } = await bvaData(await getOrgId(), date, id);
  const grant = grants[0];
  if (!grant) notFound();
  const months: string[] = [];
  const end = date < grant.endDate ? date : grant.endDate;
  for (
    let year = grant.startDate.getUTCFullYear(), month = grant.startDate.getUTCMonth();
    year * 12 + month <= end.getUTCFullYear() * 12 + end.getUTCMonth();
    month++
  ) {
    if (month === 12) {
      year++;
      month = 0;
    }
    months.push(`${year}-${String(month + 1).padStart(2, '0')}`);
  }
  const drill = (lineCode: string, month?: string) => {
    const q = new URLSearchParams({
      run: run?.id ?? '',
      grant: id,
      from: month ? `${month}-01` : grant.startDate.toISOString().slice(0, 10),
      to: month
        ? `${month}-${new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0)).getUTCDate()}`
        : label,
      rows: 'grantBudgetLine',
      cols: month ? 'month' : 'grant',
      rowKey: lineCode,
      colKey: month ?? grant.awardNumber ?? grant.name,
    });
    return `/reports/lines?${q}`;
  };
  return (
    <>
      <PageHeader
        title={`${grant.name} · Budget vs actual`}
        subtitle={`As of ${label} · Current run: ${run ? (run.finishedAt ?? run.startedAt).toISOString().replace('T', ' ').slice(0, 19) + ' UTC' : 'none'}`}
        actions={
          <>
            <Link href={`/grants/${id}`} className="btn btn-secondary btn-sm">
              ← Grant details
            </Link>
            <Link href={`/grants/${id}/bva/csv?asOf=${label}`} className="btn btn-secondary btn-sm">
              CSV
            </Link>
            <Link
              href={`/grants/${id}/bva/xlsx?asOf=${label}`}
              className="btn btn-secondary btn-sm"
            >
              XLSX
            </Link>
            <Link href={`/grants/${id}/bva/pdf?asOf=${label}`} className="btn btn-secondary btn-sm">
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
              <th>Budget line</th>
              <th className="num">Budget</th>
              <th className="num">Actual</th>
              <th className="num">Remaining</th>
              <th className="num">% used</th>
              {months.map((m) => (
                <th className="num" key={m}>
                  {m}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {grant.rows.map((r) => (
              <tr key={r.id}>
                <td>
                  {r.code} · {r.name}{' '}
                  {r.overBudget && <span className="pill pill-bad">Over budget</span>}
                </td>
                <td className="num">{formatCents(r.budgetCents)}</td>
                <td className="num">
                  <Link href={drill(r.code)}>{formatCents(r.actual)}</Link>
                </td>
                <td className="num">{formatCents(r.remaining)}</td>
                <td className="num">{formatPct1(r.actual, r.budgetCents)}</td>
                {months.map((m) => (
                  <td className="num" key={m}>
                    <Link href={drill(r.code, m)}>{formatCents(r.monthly[m] ?? 0)}</Link>
                  </td>
                ))}
              </tr>
            ))}
            <tr>
              <th>Total</th>
              <th className="num">{formatCents(grant.budget)}</th>
              <th className="num">{formatCents(grant.actual)}</th>
              <th className="num">{formatCents(grant.remaining)}</th>
              <th className="num">{formatPct1(grant.actual, grant.budget)}</th>
              {months.map((m) => (
                <th className="num" key={m}>
                  {formatCents(grant.rows.reduce((n, r) => n + (r.monthly[m] ?? 0), 0))}
                </th>
              ))}
            </tr>
          </tbody>
        </table>
      </div>
      <div className="card mt-4">
        <h2>Pacing</h2>
        <p>
          {grant.pace.elapsedDays} of {grant.pace.totalDays} days · Expected{' '}
          {formatCents(grant.pace.expectedCents)} · Actual {formatCents(grant.actual)} · Variance{' '}
          {grant.pace.varianceCents >= 0 ? '+' : ''}
          {formatCents(grant.pace.varianceCents)} ({grant.pace.varianceCents >= 0 ? '+' : ''}
          {grant.pace.variancePct}) ·{' '}
          <span className={`pill ${grant.flagged ? 'pill-warn' : 'pill-ok'}`}>
            {grant.pace.flag}
          </span>
        </p>
        <p>
          Received {formatCents(grant.received)} · Restricted balance {formatCents(grant.balance)}{' '}
          {grant.balance < 0 && <span className="pill pill-warn">spent ahead of receipts</span>}
        </p>
      </div>
      <p className="muted mt-4 text-sm">
        Actual: current-run expense allocations to budget lines within the grant period through
        as-of. Remaining = budget − actual. Received: matching income source lines in the grant
        period; restricted balance = received − actual. Expected = award × inclusive elapsed days /
        inclusive total days, rounded half-up. Any over-budget line is flagged.
      </p>
    </>
  );
}
