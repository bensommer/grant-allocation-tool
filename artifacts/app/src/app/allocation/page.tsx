import Link from 'next/link';
import { PageHeader } from '@/components/page-header';
import { toISODate } from '@/domain/dates';
import { formatBps, formatCents } from '@/domain/money';
import { parseMatchers } from '@/domain/matchers';
import { prisma } from '@/lib/db';
import { getOrgId } from '@/lib/org';
import { describeMatchers, loadLabelMaps } from '@/lib/matcher-labels';

export const dynamic = 'force-dynamic';
export default async function AllocationPage({
  searchParams,
}: {
  searchParams: Promise<{ deleted?: string }>;
}) {
  const { deleted } = await searchParams;
  const orgId = await getOrgId();
  const [rules, labels, run, programs, budgetLines] = await Promise.all([
    prisma.allocationRule.findMany({
      where: { orgId },
      include: { targets: { orderBy: { sortOrder: 'asc' } } },
      orderBy: [{ priority: 'asc' }, { name: 'asc' }],
    }),
    loadLabelMaps(orgId),
    prisma.computeRun.findFirst({ where: { orgId, isCurrent: true } }),
    prisma.program.findMany({ where: { orgId }, select: { id: true, code: true } }),
    prisma.grantBudgetLine.findMany({
      where: { orgId },
      select: { id: true, programId: true, code: true },
    }),
  ]);
  const amounts = run
    ? await prisma.allocatedLine.groupBy({
        by: ['allocationRuleId'],
        where: { orgId, computeRunId: run.id, allocationRuleId: { not: null } },
        _sum: { amountCents: true },
      })
    : [];
  const conflicts = run
    ? await prisma.allocatedLine.findMany({
        where: { orgId, computeRunId: run.id, status: 'allocation_conflict' },
        select: { conflictRuleIds: true },
      })
    : [];
  const amountMap = new Map(amounts.map((a) => [a.allocationRuleId, a._sum.amountCents ?? 0]));
  const codeMap = new Map(programs.map((p) => [p.id, p.code]));
  const lineMap = new Map(budgetLines.map((b) => [b.id, b]));
  return (
    <>
      <PageHeader
        title="Allocation rules"
        subtitle="Shared cost splits. Changes mark the current run stale until recomputed on Runs."
        actions={
          <>
            <Link className="btn btn-secondary" href="/allocation/drivers">
              Driver values
            </Link>
            <Link className="btn" href="/allocation/new">
              New rule
            </Link>
          </>
        }
      />
      {deleted ? <div className="banner banner-ok">Rule deleted.</div> : null}
      {run?.stale ? (
        <div className="banner banner-warn">
          Current run is stale. Recompute on <Link href="/runs">Runs</Link> to update allocation
          totals.
        </div>
      ) : null}
      <div className="card">
        {rules.length ? (
          <table>
            <thead>
              <tr>
                <th>Rule</th>
                <th>Priority</th>
                <th>Method</th>
                <th>Effective</th>
                <th>Status</th>
                <th>Conditions</th>
                <th>Targets</th>
                <th className="num">Current run</th>
                <th className="num">Conflicts</th>
              </tr>
            </thead>
            <tbody>
              {rules.map((rule) => (
                <tr key={rule.id}>
                  <td>
                    <Link href={`/allocation/${rule.id}`}>{rule.name}</Link>
                  </td>
                  <td>{rule.priority}</td>
                  <td>
                    {rule.method === 'fixed_pct' ? 'Fixed %' : `Driver ratio: ${rule.driverKey}`}
                  </td>
                  <td>
                    {rule.effectiveFrom ? toISODate(rule.effectiveFrom) : 'Any'} →{' '}
                    {rule.effectiveTo ? toISODate(rule.effectiveTo) : 'Any'}
                  </td>
                  <td>
                    <span className={`pill ${rule.active ? 'pill-ok' : 'pill-muted'}`}>
                      {rule.active ? 'Active' : 'Inactive'}
                    </span>
                  </td>
                  <td>{describeMatchers(parseMatchers(rule.matchers), labels)}</td>
                  <td>
                    {rule.targets
                      .map(
                        (t) =>
                          `${codeMap.get(t.programId ?? lineMap.get(t.grantBudgetLineId ?? '')?.programId ?? '') ?? lineMap.get(t.grantBudgetLineId ?? '')?.code ?? 'Unknown'} ${rule.method === 'fixed_pct' ? formatBps(t.shareBps) : 'driver'}`,
                      )
                      .join(' · ')}
                  </td>
                  <td className="num">{run ? formatCents(amountMap.get(rule.id) ?? 0) : '—'}</td>
                  <td className="num">
                    {run
                      ? conflicts.filter((c) => c.conflictRuleIds.includes(rule.id)).length
                      : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p className="muted">No allocation rules yet.</p>
        )}
      </div>
    </>
  );
}
