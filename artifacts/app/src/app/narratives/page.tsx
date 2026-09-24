import Link from 'next/link';
import { Card, DataTable, DateText, PageHeader, Period, StatusPill } from '@/components/ui';
import { prisma } from '@/lib/db';
import { getOrgId } from '@/lib/org';

export const dynamic = 'force-dynamic';
export default async function Page() {
  const rows = await prisma.narrative.findMany({
    where: { orgId: await getOrgId() },
    include: { grant: true },
    orderBy: { createdAt: 'desc' },
  });
  return (
    <>
      <PageHeader title="Narratives" subtitle="Funder financial drafts across all grants" />
      <Card>
        <DataTable caption="Narratives across all grants">
          <thead>
            <tr>
              <th>Grant</th>
              <th>Template</th>
              <th>Period</th>
              <th>Status</th>
              <th>Version</th>
              <th>Created</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                <td>
                  <Link href={`/grants/${r.grantId}/narratives/${r.id}`}>{r.grant.name}</Link>
                </td>
                <td>{r.template}</td>
                <td>
                  <Period from={r.periodFrom} to={r.periodTo} />
                </td>
                <td>
                  <StatusPill tone={r.status === 'approved' ? 'ok' : 'info'}>{r.status}</StatusPill>
                </td>
                <td>{r.version}</td>
                <td>
                  <DateText date={r.createdAt} />
                </td>
              </tr>
            ))}
          </tbody>
        </DataTable>
        {!rows.length && <p className="muted">No narratives yet. Open a grant to draft one.</p>}
      </Card>
    </>
  );
}
