import Link from 'next/link';
import { notFound } from 'next/navigation';
import { PageHeader } from '@/components/page-header';
import { formatCents } from '@/domain/money';
import { getOrgId } from '@/lib/org';
import { periodDrift } from '@/services/periods';

export const dynamic = 'force-dynamic';
export default async function DriftPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const data = await periodDrift(await getOrgId(), id);
  if (!data) notFound();
  return (
    <>
      <PageHeader
        title={`Drift · ${data.lock.name}`}
        subtitle={`Locked ${data.lock.periodFrom.toISOString().slice(0, 10)} – ${data.lock.periodTo.toISOString().slice(0, 10)}`}
        actions={
          <Link href="/settings/periods" className="btn btn-secondary">
            Period locks
          </Link>
        }
      />
      {!data.current && (
        <div className="banner banner-warn">No current compute run. Recompute to view changes.</div>
      )}
      <div className="card mb-4">
        <h2>Affected source transactions</h2>
        <ul>
          {data.affected.map((v) => (
            <li key={v.id}>
              {v.externalId} · previous version {v.version} ·{' '}
              <Link href={`/import/${v.importBatchId}/changes`}>View changes</Link>
            </li>
          ))}
          {data.added.map((v) => (
            <li key={`${v.importBatchId}-${v.externalId}`}>
              {v.externalId} · new after lock ·{' '}
              <Link href={`/import/${v.importBatchId}`}>View import</Link>
            </li>
          ))}
        </ul>
        {!data.affected.length && !data.added.length && (
          <p className="muted">No changed or deleted source rows in this period.</p>
        )}
      </div>
      <div className="card">
        <h2>Current vs locked run · grant / program / GL</h2>
        <table>
          <thead>
            <tr>
              <th>Grant</th>
              <th>Program</th>
              <th>GL</th>
              <th className="num">Locked</th>
              <th className="num">Current</th>
              <th className="num">Delta</th>
            </tr>
          </thead>
          <tbody>
            {data.deltas.map((row) => (
              <tr key={`${row.grant}|${row.program}|${row.gl}`}>
                <td>{row.grant}</td>
                <td>{row.program}</td>
                <td>{row.gl}</td>
                <td className="num">{formatCents(row.before)}</td>
                <td className="num">{formatCents(row.after)}</td>
                <td className="num">{formatCents(row.after - row.before)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
