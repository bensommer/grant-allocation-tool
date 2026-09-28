import { TERMS } from '@/copy/terms';
import Link from 'next/link';
import {
  Banner,
  ButtonLink,
  DataTable,
  DateText,
  Money,
  PageHeader,
  StatusPill,
  Th,
} from '@/components/ui';
import { formatPct } from '@/domain/format';
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
    prisma.program.findMany({ where: { orgId }, select: { id: true, name: true } }),
    prisma.grantBudgetLine.findMany({
      where: { orgId },
      select: { id: true, programId: true, name: true },
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
  const nameMap = new Map(programs.map((p) => [p.id, p.name]));
  const lineMap = new Map(budgetLines.map((b) => [b.id, b]));
  return (
    <>
      <PageHeader
        title={TERMS.sharedCostSplits}
        subtitle="How shared costs are split across programs. Numbers update by themselves after a change."
        secondaryActions={
          <>
            <ButtonLink variant="secondary" href="/allocation/drivers">
              Driver values
            </ButtonLink>
            <ButtonLink href="/allocation/new">New rule</ButtonLink>
          </>
        }
      />
      {deleted ? <Banner tone="ok">Rule deleted.</Banner> : null}
            <div className="card">
        {rules.length ? (
          <DataTable caption={TERMS.sharedCostSplits}>
            <thead>
              <tr>
                <Th>Rule</Th>
                <Th>Priority</Th>
                <Th>Method</Th>
                <Th>Effective</Th>
                <Th>Status</Th>
                <Th>Summary</Th>
                <Th num>Current run ($)</Th>
                <Th num>Conflicts</Th>
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
                    {rule.effectiveFrom ? <DateText date={rule.effectiveFrom} /> : 'Any'} →{' '}
                    {rule.effectiveTo ? <DateText date={rule.effectiveTo} /> : 'Any'}
                  </td>
                  <td>
                    <StatusPill tone={rule.active ? 'ok' : 'muted'}>
                      {rule.active ? 'Active' : 'Inactive'}
                    </StatusPill>
                  </td>
                  <td>
                    Splits {describeMatchers(parseMatchers(rule.matchers), labels)}:{' '}
                    {rule.targets
                      .map(
                        (t) =>
                          `${rule.method === 'fixed_pct' ? `${formatPct(t.shareBps)} ` : ''}${nameMap.get(t.programId ?? '') ?? lineMap.get(t.grantBudgetLineId ?? '')?.name ?? 'Unknown'}`,
                      )
                      .join(', ')}
                  </td>
                  <td className="num">
                    {run ? <Money cents={amountMap.get(rule.id) ?? 0} /> : '—'}
                  </td>
                  <td className="num">
                    {run
                      ? conflicts.filter((c) => c.conflictRuleIds.includes(rule.id)).length
                      : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </DataTable>
        ) : (
          <p className="muted">No shared cost splits yet.</p>
        )}
      </div>
    </>
  );
}
