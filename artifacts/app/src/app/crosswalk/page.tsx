import Link from 'next/link';
import {
  Banner,
  ButtonLink,
  DataTable,
  EmptyState,
  NumTd,
  PageHeader,
  StatusPill,
  Th,
} from '@/components/ui';
import { prisma } from '@/lib/db';
import { getOrgId } from '@/lib/org';
import { parseMatchers } from '@/domain/matchers';
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
        secondaryActions={
          <div className="flex flex-wrap gap-2">
            {[
              ['/crosswalk/new', 'New rule'],
              ['/crosswalk/matrix', 'Matrix'],
              ['/crosswalk/coverage', 'Coverage'],
              ['/crosswalk/conflicts', 'Conflicts'],
            ].map(([href, label]) => (
              <ButtonLink variant="secondary" key={href} href={href!}>
                {label}
              </ButtonLink>
            ))}
          </div>
        }
      />
            {deleted ? <Banner tone="ok">Rule deleted.</Banner> : null}
      {grants.map((grant) =>
        grant.budgetLines.filter((b) => b.crosswalkRules.length).length ? (
          <div className="card mb-4" key={grant.id}>
            <h2>
              {grant.name}
              <span className="muted ml-2 text-sm">{grant.awardNumber}</span>
            </h2>
            {grant.budgetLines
              .filter((b) => b.crosswalkRules.length)
              .map((b) => (
                <div key={b.id}>
                  <h3>
                    {b.name}
                    <span className="muted ml-2 text-sm">{b.code}</span>
                  </h3>
                  <DataTable caption={`Rules for ${b.name}`}>
                    <thead>
                      <tr>
                        <Th>Rule</Th>
                        <Th>Priority</Th>
                        <Th>Status</Th>
                        <Th>Matchers</Th>
                        {run ? (
                          <>
                            <Th num>Mapped ($)</Th>
                            <Th num>Pieces</Th>
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
                            <StatusPill tone={r.active ? 'ok' : 'muted'}>
                              {r.active ? 'Active' : 'Inactive'}
                            </StatusPill>
                          </td>
                          <td>{describeMatchers(parseMatchers(r.matchers), labels)}</td>
                          {run ? (
                            <>
                              <NumTd cents={byRule.get(r.id)?._sum.amountCents ?? 0} />
                              <td className="num">{byRule.get(r.id)?._count._all ?? 0}</td>
                            </>
                          ) : null}
                        </tr>
                      ))}
                    </tbody>
                  </DataTable>
                </div>
              ))}
          </div>
        ) : null,
      )}
      {grants.every((g) => g.budgetLines.every((b) => !b.crosswalkRules.length)) ? (
        <EmptyState
          title="No crosswalk rules yet"
          action={<ButtonLink href="/crosswalk/new">New rule</ButtonLink>}
        />
      ) : null}
    </>
  );
}
