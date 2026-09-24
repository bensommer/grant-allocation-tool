import Link from 'next/link';
import { notFound } from 'next/navigation';
import { PageHeader } from '@/components/page-header';
import { AuditDiff } from '@/components/audit-diff';
import { prisma } from '@/lib/db';
import { getOrgId } from '@/lib/org';

export const dynamic = 'force-dynamic';
export default async function ChangesPage({ params }: { params: Promise<{ batchId: string }> }) {
  const { batchId } = await params;
  const orgId = await getOrgId();
  const batch = await prisma.importBatch.findFirst({ where: { orgId, id: batchId } });
  if (!batch) notFound();
  const versions = await prisma.sourceRowVersion.findMany({
    where: { orgId, importBatchId: batchId, entity: 'transactions' },
    orderBy: { externalId: 'asc' },
  });
  const history = await prisma.sourceRowVersion.findMany({
    where: {
      orgId,
      entity: 'transactions',
      externalId: { in: versions.map((v) => v.externalId) },
    },
    select: { externalId: true, version: true, payload: true },
  });
  const nextByVersion = new Map(history.map((v) => [`${v.externalId}:${v.version}`, v.payload]));
  const transactions = await prisma.transaction.findMany({
    where: {
      orgId,
      sourceSystem: batch.sourceSystem,
      externalId: { in: versions.map((v) => v.externalId) },
    },
    include: { lines: { orderBy: { lineNumber: 'asc' } } },
  });
  const byId = new Map(transactions.map((t) => [t.externalId, t]));
  const counts = batch.counts as { lockIds?: string[] };
  return (
    <>
      <PageHeader
        title="Changed and deleted transactions"
        subtitle={`Import ${batch.id}`}
        actions={
          <Link href={`/import/${batch.id}`} className="btn btn-secondary">
            Import details
          </Link>
        }
      />
      {!!counts.lockIds?.length && (
        <div className="banner banner-warn">
          Locked reporting periods affected:{' '}
          {counts.lockIds.map((id) => (
            <Link key={id} className="mr-2" href={`/periods/${id}/drift`}>
              View period drift →
            </Link>
          ))}
        </div>
      )}
      <div className="card">
        {!versions.length && <p className="muted">No changed or deleted transactions.</p>}
        {versions.map((version) => {
          const current = byId.get(version.externalId);
          const before = version.payload as Record<string, unknown>;
          const next = nextByVersion.get(`${version.externalId}:${version.version + 1}`) as
            Record<string, unknown> | undefined;
          const snapshot = next ?? (current ? { ...current, lines: current.lines } : null);
          const deleted = !!snapshot?.deletedAt;
          const after = deleted ? null : snapshot;
          const oldLines = (
            (before.lines ?? []) as { lineNumber: number; deletedAt?: string | null }[]
          ).filter((line) => !line.deletedAt);
          const newLines = (
            (after?.lines ?? []) as { lineNumber: number; deletedAt?: string | null }[]
          ).filter((line) => !line.deletedAt);
          const lineNumbers = [
            ...new Set([
              ...oldLines.map((line) => line.lineNumber),
              ...newLines.map((line) => line.lineNumber),
            ]),
          ].sort((a, b) => a - b);
          const { lines: _old, ...beforeHeader } = before;
          const { lines: _new, ...afterHeader } = after ?? { lines: [] };
          return (
            <div className="mb-4" key={version.id}>
              <h2>
                {version.externalId}{' '}
                <span className={`pill ${deleted ? 'pill-warn' : 'pill-ok'}`}>
                  {deleted ? 'deleted' : 'changed'}
                </span>
              </h2>
              <AuditDiff before={beforeHeader} after={deleted ? null : afterHeader} />
              {lineNumbers.map((lineNumber) => (
                <div key={lineNumber} className="ml-4">
                  <strong>Line {lineNumber}</strong>
                  <AuditDiff
                    before={oldLines.find((line) => line.lineNumber === lineNumber)}
                    after={newLines.find((line) => line.lineNumber === lineNumber)}
                  />
                </div>
              ))}
            </div>
          );
        })}
      </div>
    </>
  );
}
