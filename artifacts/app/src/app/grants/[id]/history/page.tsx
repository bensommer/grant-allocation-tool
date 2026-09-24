import { notFound } from 'next/navigation';
import { PageHeader } from '@/components/page-header';
import { prisma } from '@/lib/db';
import { getOrgId } from '@/lib/org';
import { GrantTabs } from '../tabs';
import { AuditDiff } from '@/components/audit-diff';

export const dynamic = 'force-dynamic';

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
  return (
    <>
      <PageHeader
        title={`${grant.name} · history`}
        subtitle="Every change to this grant and its budget lines, oldest at the bottom."
      />
      <GrantTabs id={id} active="history" />
      <div className="card">
        {events.length === 0 ? (
          <p className="muted">No changes recorded.</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>When</th>
                <th>Actor</th>
                <th>Entity</th>
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
                  <td>{e.entity}</td>
                  <td>{e.action}</td>
                  <td>
                    <AuditDiff before={e.before} after={e.after} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
}
