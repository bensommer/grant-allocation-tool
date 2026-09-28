import Link from 'next/link';
import { Banner, Button, Card, DateText, PageHeader, StatusPill } from '@/components/ui';
import { TERMS, checkLabel } from '@/copy/terms';
import type { ImportCounts } from '@/datasource/import-service';
import { prisma } from '@/lib/db';
import { getOrgId } from '@/lib/org';
import { isRecomputeRunning } from '@/services/recompute-queue';
import { recomputeAction } from '@/app/runs/actions';

export const dynamic = 'force-dynamic';

type Check = { name: string; ok: boolean; status?: string };

type Entry =
  | {
      kind: 'import';
      id: string;
      at: Date;
      finishedAt: Date | null;
      status: string;
      cause: string;
      counts: { added: number; changed: number; removed: number } | null;
    }
  | {
      kind: 'calculation';
      id: string;
      at: Date;
      finishedAt: Date | null;
      status: string;
      isCurrent: boolean;
      stale: boolean;
      cause: string;
      trigger: string;
      pass: number;
      warn: number;
      fail: number;
      previousId: string | null;
    };

const TRIGGER_LABEL: Record<string, string> = {
  manual: 'Recalculate now',
  auto: 'automatic',
  import: 'after import',
};

/**
 * The audit log (JPH-28 D4): imports and calculations newest first. This is the only place with
 * a manual "Recalculate now" button — everywhere else the numbers update by themselves.
 */
export default async function ActivityPage({
  searchParams,
}: {
  searchParams: Promise<{ done?: string; failed?: string }>;
}) {
  const orgId = await getOrgId();
  const params = await searchParams;
  const [runs, batches, running] = await Promise.all([
    prisma.computeRun.findMany({ where: { orgId }, orderBy: { startedAt: 'desc' }, take: 100 }),
    prisma.importBatch.findMany({
      where: { orgId },
      orderBy: { startedAt: 'desc' },
      take: 100,
      include: { scopeGrant: { select: { name: true } } },
    }),
    isRecomputeRunning(orgId),
  ]);
  const entries: Entry[] = [
    ...batches.map((b): Entry => {
      const c = b.counts as Partial<ImportCounts>;
      const t = c.transactions;
      return {
        kind: 'import',
        id: b.id,
        at: b.startedAt,
        finishedAt: b.finishedAt,
        status: b.status,
        cause: `${b.sourceSystem === 'qbo_report' ? 'QuickBooks report' : 'QuickBooks export'}${
          b.scopeGrant ? ` · ${b.scopeGrant.name}` : ''
        }`,
        counts: t ? { added: t.new, changed: t.changed, removed: t.deleted } : null,
      };
    }),
    ...runs.map((r, i): Entry => {
      const checks = (r.checks as unknown as Check[]).filter((c) => c.name !== 'stats');
      return {
        kind: 'calculation',
        id: r.id,
        at: r.startedAt,
        finishedAt: r.finishedAt,
        status: r.status,
        isCurrent: r.isCurrent,
        stale: r.stale,
        cause: r.cause ?? TRIGGER_LABEL[r.trigger] ?? r.trigger,
        trigger: r.trigger,
        pass: checks.filter((c) => c.ok && c.status !== 'warn').length,
        warn: checks.filter((c) => c.status === 'warn').length,
        fail: checks.filter((c) => !c.ok).length,
        previousId: runs[i + 1]?.id ?? null,
      };
    }),
  ].sort((a, b) => b.at.getTime() - a.at.getTime());
  const failedChecks = params.failed
    ? ((runs.find((r) => r.id === params.failed)?.checks ?? []) as unknown as Check[])
    : [];
  return (
    <>
      <PageHeader
        title="Activity log"
        subtitle="Every import and every calculation, newest first."
        primaryAction={
          <form action={recomputeAction}>
            <Button disabled={running} data-testid="recalculate-now">
              {running ? 'Updating…' : 'Recalculate now'}
            </Button>
          </form>
        }
      />
      {params.done ? (
        <Banner tone="ok">
          Calculation finished. <Link href={`/runs/${params.done}`}>Details →</Link>
        </Banner>
      ) : null}
      {params.failed ? (
        <Banner tone="bad">
          Calculation failed; the previous calculation stays current.{' '}
          {failedChecks
            .filter((c) => !c.ok)
            .map((c) => checkLabel(c.name))
            .join(', ')}{' '}
          <Link href={`/runs/${params.failed}`}>Details →</Link>
        </Banner>
      ) : null}
      <Card title="Imports and calculations">
        {entries.length === 0 ? (
          <p className="muted">Nothing yet — start with an import.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="table" data-testid="activity-table">
              <thead>
                <tr>
                  <th>Time</th>
                  <th>Kind</th>
                  <th>Cause</th>
                  <th>Result</th>
                  <th>Counts</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {entries.map((e) => (
                  <tr key={`${e.kind}-${e.id}`} data-kind={e.kind} data-id={e.id}>
                    <td className="whitespace-nowrap">
                      <DateText date={e.finishedAt ?? e.at} time />
                    </td>
                    <td>{e.kind === 'import' ? 'Import' : 'Calculation'}</td>
                    <td>{e.cause}</td>
                    <td>
                      <StatusPill
                        tone={
                          e.status === 'failed'
                            ? 'bad'
                            : e.status === 'running'
                              ? 'warn'
                              : e.kind === 'calculation' && !e.isCurrent
                                ? 'muted'
                                : 'ok'
                        }
                      >
                        {e.kind === 'calculation'
                          ? e.isCurrent
                            ? e.stale
                              ? TERMS.needsUpdate
                              : 'Current'
                            : e.status === 'superseded'
                              ? 'Replaced'
                              : e.status.charAt(0).toUpperCase() + e.status.slice(1)
                          : e.status.charAt(0).toUpperCase() + e.status.slice(1)}
                      </StatusPill>
                    </td>
                    <td className="text-sm">
                      {e.kind === 'import'
                        ? e.counts
                          ? `${e.counts.added} new · ${e.counts.changed} changed · ${e.counts.removed} removed`
                          : '—'
                        : e.status === 'failed'
                          ? `${e.fail} health check${e.fail === 1 ? '' : 's'} failed`
                          : `${e.pass} pass · ${e.warn} warn`}
                    </td>
                    <td className="whitespace-nowrap">
                      <Link href={e.kind === 'import' ? `/import/${e.id}` : `/runs/${e.id}`}>
                        Details
                      </Link>
                      {e.kind === 'calculation' && e.previousId && e.status !== 'failed' ? (
                        <>
                          {' · '}
                          <Link href={`/runs/${e.id}/diff?against=${e.previousId}`}>
                            Compare with previous
                          </Link>
                        </>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </>
  );
}
