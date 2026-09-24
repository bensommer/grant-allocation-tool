import Link from 'next/link';
import { notFound } from 'next/navigation';
import {
  ButtonLink,
  Card,
  DataTable,
  DateText,
  PageHeader,
  Period,
  StatusPill,
} from '@/components/ui';
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
        secondaryActions={
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
          <ButtonLink href={`/grants/${id}/narratives/new`}>New narrative</ButtonLink>
        </p>
      )}
      <Card>
        <DataTable caption={`${grant.name} narratives`}>
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
                  <Period from={row.periodFrom} to={row.periodTo} />
                </td>
                <td>
                  <StatusPill tone={row.status === 'approved' ? 'ok' : 'info'}>
                    {row.status}
                  </StatusPill>
                </td>
                <td>{row.version}</td>
                <td>
                  <DateText date={row.createdAt} />
                </td>
                <td>{row.approvedBy ?? '—'}</td>
              </tr>
            ))}
          </tbody>
        </DataTable>
        {!rows.length && <p className="muted">No narratives yet.</p>}
      </Card>
    </>
  );
}
