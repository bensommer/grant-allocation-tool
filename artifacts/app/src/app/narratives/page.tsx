import Link from 'next/link';
import { PageHeader } from '@/components/page-header';
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
      <div className="card overflow-x-auto">
        <table>
          <thead>
            <tr>
              <th>Grant</th>
              <th>Template</th>
              <th>Period</th>
              <th>Status</th>
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
                  {r.periodFrom.toISOString().slice(0, 10)} –{' '}
                  {r.periodTo.toISOString().slice(0, 10)}
                </td>
                <td>
                  <span className="pill">{r.status}</span>
                </td>
                <td>{r.createdAt.toISOString().slice(0, 10)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {!rows.length && <p className="muted">No narratives yet. Open a grant to draft one.</p>}
      </div>
    </>
  );
}
