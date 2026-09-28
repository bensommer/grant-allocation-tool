import { notFound } from 'next/navigation';
import { PageHeader } from '@/components/page-header';
import { prisma } from '@/lib/db';
import { getOrgId } from '@/lib/org';
import { EditGrantButton } from '@/app/grants/[id]/edit-grant-button';
import { GrantTabs } from '@/app/grants/[id]/tabs';
import { HistoryDiff, type NameLookup } from '@/components/history-diff';

export const dynamic = 'force-dynamic';

const ENTITY_LABEL: Record<string, string> = { Grant: 'Grant', GrantBudgetLine: 'Budget line' };

export default async function GrantHistoryPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const orgId = await getOrgId();
  const grant = await prisma.grant.findFirst({
    where: { id, orgId },
    include: { budgetLines: { select: { id: true } } },
  });
  if (!grant) notFound();
  const events = await prisma.auditEvent.findMany({
    where: {
      orgId,
      OR: [
        { entity: 'Grant', entityId: id },
        { entity: 'GrantBudgetLine', entityId: { in: grant.budgetLines.map((b) => b.id) } },
        { entity: 'GrantBudgetLine', before: { path: ['grantId'], equals: id } },
      ],
    },
    orderBy: { at: 'desc' },
    take: 200,
  });
  // Names for the id-valued fields the rows may mention (A8: ids → names).
  const [parties, accounts, classes, programs, lines, activities] = await Promise.all([
    prisma.party.findMany({ where: { orgId }, select: { id: true, displayName: true } }),
    prisma.account.findMany({ where: { orgId }, select: { id: true, name: true, number: true } }),
    prisma.trackingClass.findMany({ where: { orgId }, select: { id: true, name: true } }),
    prisma.program.findMany({ where: { orgId }, select: { id: true, name: true } }),
    prisma.grantBudgetLine.findMany({
      where: { orgId, grantId: id },
      select: { id: true, name: true, code: true },
    }),
    prisma.grantActivity.findMany({ where: { grantId: id }, select: { id: true, name: true } }),
  ]);
  const names: NameLookup = {
    party: new Map(parties.map((p) => [p.id, p.displayName])),
    account: new Map(accounts.map((a) => [a.id, a.number ? `${a.name} ${a.number}` : a.name])),
    class: new Map(classes.map((c) => [c.id, c.name])),
    program: new Map(programs.map((p) => [p.id, p.name])),
    budgetLine: new Map(lines.map((l) => [l.id, `${l.code} ${l.name}`])),
    activity: new Map(activities.map((a) => [a.id, a.name])),
  };
  return (
    <>
      <PageHeader
        title={`${grant.name} · history`}
        subtitle="Every change to this grant and its budget lines, oldest at the bottom."
        secondaryActions={<EditGrantButton id={id} />}
      />
      <GrantTabs id={id} active="history" />
      <div className="card">
        {events.length === 0 ? (
          <p className="muted">No changes recorded.</p>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>When</th>
                  <th>Actor</th>
                  <th>What</th>
                  <th>Action</th>
                  <th>Changes</th>
                </tr>
              </thead>
              <tbody>
                {events.map((e) => (
                  <tr key={e.id}>
                    <td className="whitespace-nowrap">
                      {e.at.toISOString().replace('T', ' ').slice(0, 19)}
                    </td>
                    <td>{e.actor}</td>
                    <td>{ENTITY_LABEL[e.entity] ?? e.entity}</td>
                    <td className="capitalize">{e.action}</td>
                    <td>
                      <HistoryDiff before={e.before} after={e.after} names={names} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  );
}
