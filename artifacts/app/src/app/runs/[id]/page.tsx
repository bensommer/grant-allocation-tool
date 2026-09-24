import Link from 'next/link';
import { notFound } from 'next/navigation';
import { PageHeader } from '@/components/page-header';
import { prisma } from '@/lib/db';
import { getOrgId } from '@/lib/org';
import { RunStatusPill } from '../status-pill';

export const dynamic = 'force-dynamic';

type Warning = { code: string; message: string; sourceLineId?: string; ruleIds?: string[] };
type Check = { name: string; ok: boolean; detail?: unknown };

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
        subtitle={`Started ${run.startedAt.toISOString().replace('T', ' ').slice(0, 19)} UTC · config ${run.configHash}`}
        actions={
          <Link href="/runs" className="btn btn-secondary btn-sm">
            All runs
          </Link>
        }
      />
      <div className="card mb-4">
        <p>
          <RunStatusPill status={run.status} />{' '}
          {run.isCurrent ? <span className="pill pill-ok">current</span> : null}{' '}
          {run.stale ? <span className="pill pill-warn">stale</span> : null}
        </p>
        <table className="mt-3">
          <tbody>
            {checks.map((c) => (
              <tr key={c.name}>
                <th>{c.name}</th>
                <td>
                  {c.ok ? (
                    <span className="pill pill-ok">ok</span>
                  ) : (
                    <span className="pill pill-bad">failed</span>
                  )}
                </td>
                <td>
                  <code className="text-xs">
                    {typeof c.detail === 'string' ? c.detail : JSON.stringify(c.detail)}
                  </code>
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
        </table>
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
                    {o.startedAt.toISOString().replace('T', ' ').slice(0, 19)} · {o.status} ·{' '}
                    {o.configHash}
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
            <table>
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
                      <span
                        className={`pill ${w.code.includes('conflict') ? 'pill-bad' : 'pill-warn'}`}
                      >
                        {w.code}
                      </span>
                    </td>
                    <td>{w.message}</td>
                    <td>
                      {w.sourceLineId ? <Link href={`/lines/${w.sourceLineId}`}>audit</Link> : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        )}
      </div>
    </>
  );
}
