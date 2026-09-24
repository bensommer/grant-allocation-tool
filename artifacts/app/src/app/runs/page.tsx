import Link from 'next/link';
import { Button, DataTable, DateText, PageHeader, StatusPill, Th } from '@/components/ui';
import { prisma } from '@/lib/db';
import { getOrgId } from '@/lib/org';
import { recomputeAction } from './actions';

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
        primaryAction={
          <form action={recomputeAction}>
            <Button>Recompute now</Button>
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
          <DateText date={current.finishedAt ?? current.startedAt} time /> until you recompute.
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
          <DataTable caption="Compute runs">
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
                      <DateText date={r.startedAt} time />
                      {r.isCurrent ? <StatusPill tone="ok">current</StatusPill> : null}
                      {r.stale && r.isCurrent ? <StatusPill tone="warn">stale</StatusPill> : null}
                    </td>
                    <td>
                      <StatusPill
                        tone={
                          r.status === 'succeeded'
                            ? 'ok'
                            : r.status === 'failed'
                              ? 'bad'
                              : r.status === 'superseded'
                                ? 'muted'
                                : 'warn'
                        }
                      >
                        {r.status.charAt(0).toUpperCase() + r.status.slice(1)}
                      </StatusPill>
                    </td>
                    <td className="num">
                      {r.finishedAt ? `${r.finishedAt.getTime() - r.startedAt.getTime()} ms` : '–'}
                    </td>
                    <td>
                      <span className="break-all">{r.configHash}</span>
                    </td>
                    <td className="num">{stats ? `${stats.lines} → ${stats.pieces}` : '–'}</td>
                    <td className="num">{warnings}</td>
                    <td className="num">
                      {conflicts > 0 ? (
                        <StatusPill tone="bad">{conflicts} conflicts</StatusPill>
                      ) : (
                        '0'
                      )}
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
          </DataTable>
        )}
      </div>
    </>
  );
}
