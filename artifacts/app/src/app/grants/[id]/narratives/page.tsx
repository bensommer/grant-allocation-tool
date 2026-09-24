import Link from 'next/link';
import { notFound } from 'next/navigation';
import { PageHeader } from '@/components/page-header';
import { prisma } from '@/lib/db';
import { getOrgId } from '@/lib/org';
import { narrativeModel } from '@/narratives/client';

export const dynamic = 'force-dynamic';
export default async function NarrativesPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const orgId = await getOrgId();
  const grant = await prisma.grant.findFirst({ where: { id, orgId } });
  if (!grant) notFound();
  const rows = await prisma.narrative.findMany({
    where: { orgId, grantId: id },
    orderBy: { createdAt: 'desc' },
  });
  return (
    <>
      <PageHeader
        title={`${grant.name} · Narratives`}
        actions={
          <Link className="btn btn-secondary btn-sm" href={`/grants/${id}`}>
            ← Grant
          </Link>
        }
      />
      {!narrativeModel() && (
        <div className="banner banner-warn">
          Generation is disabled: set ANTHROPIC_API_KEY and NARRATIVE_MODEL to draft narratives.
          Existing narratives remain available.
        </div>
      )}
      {narrativeModel() && (
        <p className="mb-4">
          <Link className="btn" href={`/grants/${id}/narratives/new`}>
            New narrative
          </Link>
        </p>
      )}
      <div className="card overflow-x-auto">
        <table>
          <thead>
            <tr>
              <th>Template</th>
              <th>Period</th>
              <th>Status</th>
              <th>Version</th>
              <th>Created</th>
              <th>Approved by</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id}>
                <td>
                  <Link href={`/grants/${id}/narratives/${row.id}`}>{row.template}</Link>
                </td>
                <td>
                  {row.periodFrom.toISOString().slice(0, 10)} –{' '}
                  {row.periodTo.toISOString().slice(0, 10)}
                </td>
                <td>
                  <span className="pill">{row.status}</span>
                </td>
                <td>{row.version}</td>
                <td>{row.createdAt.toISOString().slice(0, 10)}</td>
                <td>{row.approvedBy ?? '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {!rows.length && <p className="muted">No narratives yet.</p>}
      </div>
    </>
  );
}
