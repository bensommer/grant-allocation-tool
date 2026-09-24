import Link from 'next/link';
import { PageHeader } from '@/components/page-header';
import { formatCents } from '@/domain/money';
import { getOrgId } from '@/lib/org';
import { loadReport } from '@/reports/query';
import { parseParams } from '@/reports/params';
export const dynamic = 'force-dynamic';
export default async function Lines({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const raw = await searchParams,
    p = parseParams(raw);
  const { run, facts } = await loadReport(await getOrgId(), p);
  const filtered = facts.filter(
    (f) =>
      f[p.rows] === p.rowKey &&
      f[p.cols] === p.colKey &&
      (!p.page || !p.pageKey || f[p.page] === p.pageKey),
  );
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(raw))
    if (!['rowKey', 'colKey', 'pageKey'].includes(k))
      for (const s of Array.isArray(v) ? v : v ? [v] : []) q.append(k, s);
  return (
    <>
      <PageHeader
        title={`${p.rowKey ?? ''} × ${p.colKey ?? ''}`}
        subtitle={
          run
            ? `Run ${(run.finishedAt ?? run.startedAt).toISOString()} — ${filtered.length} pieces`
            : 'No current run'
        }
        actions={
          <Link className="btn btn-secondary" href={`/reports/custom?${q}`}>
            Back to report
          </Link>
        }
      />
      {run?.stale ? (
        <div className="banner banner-warn">
          Configuration changed since the current run. Reports show numbers from{' '}
          {(run.finishedAt ?? run.startedAt).toISOString()} until you recompute.
        </div>
      ) : null}
      <div className="card">
        <table>
          <thead>
            <tr>
              <th>Date</th>
              <th>Doc</th>
              <th>Description</th>
              <th>Program</th>
              <th>Grant</th>
              <th>Status</th>
              <th className="num">Amount</th>
              <th>Source</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((f) => (
              <tr key={f.pieceId}>
                <td>{f.date}</td>
                <td>{f.doc}</td>
                <td>{f.description}</td>
                <td>{f.program}</td>
                <td>{f.grant}</td>
                <td>{f.status}</td>
                <td className="num">{formatCents(f.amountCents)}</td>
                <td>
                  <Link href={`/lines/${f.sourceLineId}`}>View line</Link>
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <th colSpan={6}>Total</th>
              <td className="num">
                {formatCents(filtered.reduce((n, f) => n + f.amountCents, 0))}
              </td>
              <td />
            </tr>
          </tfoot>
        </table>
      </div>
    </>
  );
}
