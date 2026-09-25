import Link from 'next/link';
import { notFound } from 'next/navigation';
import { PageHeader } from '@/components/page-header';
import { Banner, StatusPill } from '@/components/ui';
import { prisma } from '@/lib/db';
import { getOrgId } from '@/lib/org';
import { categoryLabel } from '@/domain/categories';
import { parseMatchers } from '@/domain/matchers';
import { describeMatchers, loadLabelMaps } from '@/lib/matcher-labels';
import { GrantTabs } from '../tabs';

export const dynamic = 'force-dynamic';

export default async function GrantRulesPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ deactivated?: string }>;
}) {
  const { id } = await params;
  const { deactivated } = await searchParams;
  const orgId = await getOrgId();
  const grant = await prisma.grant.findFirst({ where: { id, orgId } });
  if (!grant) notFound();
  const [rules, labels] = await Promise.all([
    prisma.crosswalkRule.findMany({
      where: { orgId, grantId: id },
      include: {
        grantBudgetLine: { select: { code: true } },
        targetActivity: { select: { name: true } },
      },
      orderBy: [{ active: 'desc' }, { priority: 'asc' }, { name: 'asc' }],
    }),
    loadLabelMaps(orgId),
  ]);
  return (
    <>
      <PageHeader
        title={`${grant.name} · rules`}
        subtitle="Grant rules decide where each member line lands: a working line directly, or an activity and a category that together pick a cell. Lowest priority wins; manual decisions always beat rules."
        actions={
          <Link href={`/grants/${id}/rules/new`} className="btn btn-sm">
            New rule
          </Link>
        }
      />
      <GrantTabs id={id} active="rules" />
      {deactivated ? (
        <Banner tone="warn">The rule is referenced by a compute run, so it was deactivated.</Banner>
      ) : null}
      <div className="card max-w-full overflow-x-auto">
        <table data-testid="grant-rules">
          <thead>
            <tr>
              <th className="num">Priority</th>
              <th>Name</th>
              <th>Decides</th>
              <th>Target</th>
              <th>Matches when</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {rules.length === 0 ? (
              <tr>
                <td colSpan={6} className="muted">
                  No grant rules yet.
                </td>
              </tr>
            ) : null}
            {rules.map((r) => (
              <tr key={r.id} data-rule-name={r.name ?? ''} data-dimension={r.dimension}>
                <td className="num">{r.priority}</td>
                <td>
                  <Link href={`/grants/${id}/rules/${r.id}`}>{r.name ?? '(unnamed)'}</Link>
                </td>
                <td>{r.dimension}</td>
                <td>
                  {r.dimension === 'line'
                    ? (r.grantBudgetLine?.code ?? '—')
                    : r.dimension === 'activity'
                      ? (r.targetActivity?.name ?? '—')
                      : categoryLabel(r.targetCategoryKey)}
                </td>
                <td className="text-xs">{describeMatchers(parseMatchers(r.matchers), labels)}</td>
                <td>
                  {r.active ? (
                    <StatusPill tone="ok">active</StatusPill>
                  ) : (
                    <StatusPill tone="muted">inactive</StatusPill>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
