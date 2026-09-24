import Link from 'next/link';
import { PageHeader } from '@/components/page-header';
import { prisma } from '@/lib/db';
import { getOrgId } from '@/lib/org';
import { recomputeAction } from './actions';
import { RunStatusPill } from './status-pill';

export const dynamic = 'force-dynamic';

type Check = { name: string; ok: boolean; detail?: unknown };
type Stats = {
  lines: number;
  pieces: number;
  allocationConflicts: number;
  crosswalkConflicts: number;
  unassigned: number;
  unmapped: number;
};

export default async function RunsPage({
  searchParams,
}: {
  searchParams: Promise<{ done?: string; failed?: string }>;
}) {
  const { done, failed } = await searchParams;
  const orgId = await getOrgId();
  const runs = await prisma.computeRun.findMany({
    where: { orgId },
    orderBy: { startedAt: 'desc' },
    take: 50,
  });
  const current = runs.find((r) => r.isCurrent);
  const failedRun = failed ? runs.find((r) => r.id === failed) : undefined;
  const failedCheck = failedRun ? (failedRun.checks as Check[]).find((c) => !c.ok) : undefined;

  return (
    <>
      <PageHeader
        title="Compute runs"
        subtitle="Every recompute is a new run; reports always read from the current successful run."
        actions={
          <form action={recomputeAction}>
            <button type="submit" className="btn">
              Recompute now
            </button>
          </form>
        }
      />
      {done ? (
        <div className="banner banner-ok">
          Recompute succeeded. Run {done.slice(-8)} is now current.
        </div>
      ) : null}
      {failedRun ? (
        <div className="banner banner-bad">
          Recompute failed and was not promoted; the previous run stays current.{' '}
          {failedCheck ? String(failedCheck.detail) : null}
        </div>
      ) : null}
      {current?.stale ? (
        <div className="banner banner-warn">
          Configuration changed since the current run. Reports show numbers from{' '}
          {stamp(current.finishedAt ?? current.startedAt)} until you recompute.
        </div>
      ) : null}
      {!current ? (
        <div className="banner banner-warn">
          No successful run yet. Import data, then recompute.
        </div>
      ) : null}

      <div className="card">
        {runs.length === 0 ? (
          <p className="muted">No runs yet.</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Started</th>
                <th>Status</th>
                <th className="num">Duration</th>
                <th>Config hash</th>
                <th className="num">Lines → pieces</th>
                <th className="num">Warnings</th>
                <th className="num">Conflicts</th>
                <th>Compare</th>
              </tr>
            </thead>
            <tbody>
              {runs.map((r, i) => {
                const stats = ((r.checks as Check[]).find((c) => c.name === 'stats')?.detail ??
                  null) as Stats | null;
                const warnings = (r.warnings as unknown[]).length;
                const conflicts = stats ? stats.allocationConflicts + stats.crosswalkConflicts : 0;
                const previous = runs
                  .slice(i + 1)
                  .find((p) => p.status === 'succeeded' || p.status === 'superseded');
                return (
                  <tr key={r.id}>
                    <td className="whitespace-nowrap">
                      {stamp(r.startedAt)}
                      {r.isCurrent ? <span className="pill pill-ok ml-2">current</span> : null}
                      {r.stale && r.isCurrent ? (
                        <span className="pill pill-warn ml-1">stale</span>
                      ) : null}
                    </td>
                    <td>
                      <RunStatusPill status={r.status} />
                    </td>
                    <td className="num">
                      {r.finishedAt ? `${r.finishedAt.getTime() - r.startedAt.getTime()} ms` : '–'}
                    </td>
                    <td>
                      <code>{r.configHash}</code>
                    </td>
                    <td className="num">{stats ? `${stats.lines} → ${stats.pieces}` : '–'}</td>
                    <td className="num">{warnings}</td>
                    <td className="num">
                      {conflicts > 0 ? <span className="pill pill-bad">{conflicts}</span> : '0'}
                    </td>
                    <td className="whitespace-nowrap">
                      <Link href={`/runs/${r.id}`}>Detail</Link>
                      {previous && r.status !== 'failed' ? (
                        <>
                          {' · '}
                          <Link href={`/runs/${r.id}/diff?against=${previous.id}`}>
                            Diff vs previous
                          </Link>
                        </>
                      ) : null}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
}

function stamp(d: Date): string {
  return d.toISOString().replace('T', ' ').slice(0, 19) + ' UTC';
}
