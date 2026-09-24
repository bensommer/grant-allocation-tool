import Link from 'next/link';
import { notFound } from 'next/navigation';
import { DataTable, NumTd, PageHeader, Period } from '@/components/ui';
import { getOrgId } from '@/lib/org';
import { prisma } from '@/lib/db';
import { periodDrift } from '@/services/periods';

export const dynamic = 'force-dynamic';
export default async function DriftPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const orgId = await getOrgId();
  const data = await periodDrift(orgId, id);
  if (!data) notFound();
  const [programs, accounts] = await Promise.all([
    prisma.program.findMany({ where: { orgId }, select: { code: true, name: true } }),
    prisma.account.findMany({ where: { orgId }, select: { number: true, name: true } }),
  ]);
  const programNames = new Map(programs.map((p) => [p.code, p.name]));
  const accountNames = new Map(accounts.map((a) => [a.number, a.name]));
  return (
    <>
      <PageHeader
        title={`Drift · ${data.lock.name}`}
        subtitle={
          <>
            Locked <Period from={data.lock.periodFrom} to={data.lock.periodTo} />
          </>
        }
        secondaryActions={
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
        <DataTable caption="Current vs locked run">
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
                <td>
                  {programNames.get(row.program) ?? row.program}
                  {programNames.has(row.program) && (
                    <small className="muted"> · {row.program}</small>
                  )}
                </td>
                <td>
                  {accountNames.get(row.gl) ?? row.gl}
                  {accountNames.has(row.gl) && <small className="muted"> · {row.gl}</small>}
                </td>
                <NumTd cents={row.before} />
                <NumTd cents={row.after} />
                <NumTd cents={row.after - row.before} />
              </tr>
            ))}
          </tbody>
        </DataTable>
      </div>
    </>
  );
}
