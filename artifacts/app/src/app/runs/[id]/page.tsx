import Link from 'next/link';
import { notFound } from 'next/navigation';
import { DataTable, DateText, PageHeader, StatusPill } from '@/components/ui';
import { prisma } from '@/lib/db';
import { getOrgId } from '@/lib/org';

export const dynamic = 'force-dynamic';

type Warning = { code: string; message: string; sourceLineId?: string; ruleIds?: string[] };
type Check = {
  name: string;
  ok: boolean;
  status?: 'pass' | 'warn' | 'fail';
  detail?: unknown;
  href?: string;
};

export default async function RunDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const orgId = await getOrgId();
  const run = await prisma.computeRun.findFirst({ where: { id, orgId } });
  if (!run) notFound();
  const warnings = run.warnings as Warning[];
  const checks = run.checks as Check[];
  const byCode = new Map<string, number>();
  for (const w of warnings) byCode.set(w.code, (byCode.get(w.code) ?? 0) + 1);
  const others = await prisma.computeRun.findMany({
    where: { orgId, id: { not: id }, status: { in: ['succeeded', 'superseded'] } },
    orderBy: { startedAt: 'desc' },
    take: 20,
  });

  return (
    <>
      <PageHeader
        title={`Run ${id.slice(-8)}`}
        subtitle={
          <>
            Started <DateText date={run.startedAt} time /> · config {run.configHash}
          </>
        }
        secondaryActions={
          <Link href="/runs" className="btn btn-secondary btn-sm">
            All runs
          </Link>
        }
      />
      <div className="card mb-4">
        <p>
          <StatusPill
            tone={run.status === 'succeeded' ? 'ok' : run.status === 'failed' ? 'bad' : 'muted'}
          >
            {run.status.charAt(0).toUpperCase() + run.status.slice(1)}
          </StatusPill>{' '}
          {run.isCurrent ? <StatusPill tone="ok">current</StatusPill> : null}{' '}
          {run.stale ? <StatusPill tone="warn">stale</StatusPill> : null}
        </p>
        <DataTable caption="Run checks">
          <tbody>
            {checks.map((c) => (
              <tr key={c.name}>
                <th>
                  {c.href ? <Link href={c.href}>{c.name.replaceAll('_', ' ')}</Link> : c.name}
                </th>
                <td>
                  <StatusPill tone={c.status === 'warn' ? 'warn' : c.ok ? 'ok' : 'bad'}>
                    {c.status ?? (c.ok ? 'pass' : 'fail')}
                  </StatusPill>
                </td>
                <td>
                  <span className="text-xs break-words">
                    {typeof c.detail === 'string' ? c.detail : JSON.stringify(c.detail)}
                  </span>
                </td>
              </tr>
            ))}
            <tr>
              <th>Source batches</th>
              <td colSpan={2}>
                {run.sourceBatchIds.map((b) => (
                  <Link key={b} href={`/import/${b}`} className="mr-2">
                    {b.slice(-8)}
                  </Link>
                ))}
              </td>
            </tr>
          </tbody>
        </DataTable>
      </div>

      {others.length > 0 && run.status !== 'failed' ? (
        <div className="card mb-4">
          <h2 className="mb-2">Compare with another run</h2>
          <form method="get" action={`/runs/${id}/diff`} className="flex items-end gap-2">
            <div>
              <label htmlFor="against">Against</label>
              <select id="against" name="against">
                {others.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.startedAt.toLocaleString('en-US', {
                      timeZone: 'UTC',
                      dateStyle: 'medium',
                      timeStyle: 'short',
                    })}{' '}
                    · {o.status} · {o.configHash}
                  </option>
                ))}
              </select>
            </div>
            <button type="submit" className="btn btn-secondary">
              Show diff
            </button>
          </form>
        </div>
      ) : null}

      <div className="card">
        <h2 className="mb-2">Warnings ({warnings.length})</h2>
        {warnings.length === 0 ? (
          <p className="muted">None.</p>
        ) : (
          <>
            <p className="muted mb-2 text-xs">
              {[...byCode.entries()].map(([code, n]) => `${code}: ${n}`).join(' · ')}
            </p>
            <DataTable caption="Run warnings">
              <thead>
                <tr>
                  <th>Code</th>
                  <th>Message</th>
                  <th>Line</th>
                </tr>
              </thead>
              <tbody>
                {warnings.slice(0, 500).map((w, i) => (
                  <tr key={i}>
                    <td>
                      <StatusPill tone={w.code.includes('conflict') ? 'bad' : 'warn'}>
                        {w.code}
                      </StatusPill>
                    </td>
                    <td>{w.message}</td>
                    <td>
                      {w.sourceLineId ? <Link href={`/lines/${w.sourceLineId}`}>audit</Link> : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </DataTable>
          </>
        )}
      </div>
    </>
  );
}
