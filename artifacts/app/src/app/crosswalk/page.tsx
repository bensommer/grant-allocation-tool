import Link from 'next/link';
import { PageHeader } from '@/components/page-header';
import { prisma } from '@/lib/db';
import { getOrgId } from '@/lib/org';
import { parseMatchers } from '@/domain/matchers';
import { formatCents } from '@/domain/money';
import { describeMatchers, loadLabelMaps } from '@/lib/matcher-labels';

export const dynamic = 'force-dynamic';

export default async function CrosswalkPage({
  searchParams,
}: {
  searchParams: Promise<{ deleted?: string }>;
}) {
  const { deleted } = await searchParams;
  const orgId = await getOrgId();
  const [grants, labels, run] = await Promise.all([
    prisma.grant.findMany({
      where: { orgId },
      orderBy: { name: 'asc' },
      include: {
        budgetLines: {
          orderBy: { sortOrder: 'asc' },
          include: { crosswalkRules: { where: { orgId }, orderBy: { priority: 'asc' } } },
        },
      },
    }),
    loadLabelMaps(orgId),
    prisma.computeRun.findFirst({ where: { orgId, isCurrent: true } }),
  ]);
  const totals = run
    ? await prisma.allocatedLine.groupBy({
        by: ['crosswalkRuleId'],
        where: { orgId, computeRunId: run.id, crosswalkRuleId: { not: null } },
        _sum: { amountCents: true },
        _count: { _all: true },
      })
    : [];
  const byRule = new Map(totals.map((r) => [r.crosswalkRuleId, r]));
  return (
    <>
      <PageHeader
        title="Crosswalk"
        subtitle="Map expense pieces to grant budget lines. Changes mark the current run stale."
        actions={
          <div className="flex flex-wrap gap-2">
            {[
              ['/crosswalk/new', 'New rule'],
              ['/crosswalk/matrix', 'Matrix'],
              ['/crosswalk/coverage', 'Coverage'],
              ['/crosswalk/conflicts', 'Conflicts'],
            ].map(([href, label]) => (
              <Link className="btn btn-secondary btn-sm" key={href} href={href!}>
                {label}
              </Link>
            ))}
          </div>
        }
      />
      {run?.stale ? (
        <div className="banner banner-warn">
          Current run is stale — recompute on <Link href="/runs">/runs</Link>.
        </div>
      ) : null}
      {deleted ? <div className="banner banner-ok">Rule deleted.</div> : null}
      {grants.map((grant) =>
        grant.budgetLines.filter((b) => b.crosswalkRules.length).length ? (
          <div className="card mb-4" key={grant.id}>
            <h2>
              {grant.awardNumber ?? grant.name} — {grant.name}
            </h2>
            {grant.budgetLines
              .filter((b) => b.crosswalkRules.length)
              .map((b) => (
                <div key={b.id}>
                  <h3>
                    {b.code} — {b.name}
                  </h3>
                  <table>
                    <thead>
                      <tr>
                        <th>Rule</th>
                        <th>Priority</th>
                        <th>Active</th>
                        <th>Matchers</th>
                        {run ? (
                          <>
                            <th className="num">Mapped</th>
                            <th className="num">Pieces</th>
                          </>
                        ) : null}
                      </tr>
                    </thead>
                    <tbody>
                      {b.crosswalkRules.map((r) => (
                        <tr key={r.id}>
                          <td>
                            <Link href={`/crosswalk/${r.id}`}>{r.name}</Link>
                          </td>
                          <td>{r.priority}</td>
                          <td>
                            <span className={`pill ${r.active ? 'pill-ok' : 'pill-muted'}`}>
                              {r.active ? 'Active' : 'Inactive'}
                            </span>
                          </td>
                          <td>{describeMatchers(parseMatchers(r.matchers), labels)}</td>
                          {run ? (
                            <>
                              <td className="num">
                                {formatCents(byRule.get(r.id)?._sum.amountCents ?? 0)}
                              </td>
                              <td className="num">{byRule.get(r.id)?._count._all ?? 0}</td>
                            </>
                          ) : null}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ))}
          </div>
        ) : null,
      )}
      {grants.every((g) => g.budgetLines.every((b) => !b.crosswalkRules.length)) ? (
        <div className="card muted">No crosswalk rules yet.</div>
      ) : null}
    </>
  );
}
