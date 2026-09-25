import { getOrgId } from '@/lib/org';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import {
  Banner,
  ButtonLink,
  Card,
  DataTable,
  DateText,
  KeyFigure,
  Money,
  PageHeader,
  Period,
  StatusPill,
} from '@/components/ui';
import { prisma } from '@/lib/db';
import type { ImportCounts } from '@/datasource/import-service';
import type { ChecksumResult, ImportError } from '@/datasource/types';
import { scopeSummary } from '@/services/grant-membership';

export const dynamic = 'force-dynamic';
const PAGE_SIZE = 50;

export default async function BatchPage({
  params,
  searchParams,
}: {
  params: Promise<{ batchId: string }>;
  searchParams: Promise<{ page?: string }>;
}) {
  const { batchId } = await params;
  const { page: pageRaw } = await searchParams;
  const orgId = await getOrgId();
  const batch = await prisma.importBatch.findFirst({
    where: { id: batchId, orgId },
    include: { scopeGrant: { select: { id: true, name: true } } },
  });
  if (!batch) notFound();
  const checksums = (batch.checksums as unknown as ChecksumResult[] | null) ?? [];
  const reportMeta = (batch.reportMeta as Record<string, string | null> | null) ?? {};
  const scope =
    batch.scopeGrant && batch.scopeDateFrom && batch.scopeDateTo
      ? { grant: batch.scopeGrant, dateFrom: batch.scopeDateFrom, dateTo: batch.scopeDateTo }
      : null;
  const scopeTotals =
    scope && batch.status === 'succeeded'
      ? await scopeSummary(prisma, orgId, {
          grantId: scope.grant.id,
          dateFrom: scope.dateFrom,
          dateTo: scope.dateTo,
        })
      : null;

  const counts = batch.counts as Partial<ImportCounts>;
  const lockIds = ((batch.counts as { lockIds?: string[] }).lockIds ?? []).filter(Boolean);
  const errors = batch.errors as unknown as ImportError[];
  const page = Math.max(1, Number(pageRaw ?? '1') || 1);
  const pages = Math.max(1, Math.ceil(errors.length / PAGE_SIZE));
  const slice = errors.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  const entities = ['accounts', 'classes', 'locations', 'parties', 'transactions'] as const;

  return (
    <>
      <PageHeader
        title={`Import batch`}
        subtitle={
          <>
            {batch.sourceSystem} · started <DateText date={batch.startedAt} time />
          </>
        }
        secondaryActions={
          <>
            <Link href="/import" className="btn btn-secondary btn-sm">
              All imports
            </Link>
            {errors.length > 0 ? (
              <a href={`/import/${batch.id}/errors.csv`} className="btn btn-sm">
                Download errors (CSV)
              </a>
            ) : null}
          </>
        }
      />

      <div className="mb-4 flex items-center gap-3">
        <StatusPill
          tone={batch.status === 'succeeded' ? 'ok' : batch.status === 'failed' ? 'bad' : 'warn'}
        >
          {batch.status.charAt(0).toUpperCase() + batch.status.slice(1)}
        </StatusPill>
        <span className="muted text-xs break-all">{batch.id}</span>
      </div>

      {batch.status === 'failed' ? (
        <div className="banner banner-bad">
          Import failed with {errors.length} error(s). Nothing was written.
        </div>
      ) : batch.status === 'succeeded' ? (
        <div className="banner banner-ok">
          Succeeded — {counts.lines ?? 0} transaction lines in this batch.{' '}
          <Link href={`/import/${batch.id}/changes`}>View changed and deleted transactions →</Link>
        </div>
      ) : null}
      {!!lockIds.length && (
        <div className="banner banner-warn">
          This import changed source lines inside a locked reporting period:{' '}
          {lockIds.map((id) => (
            <Link key={id} className="mr-2" href={`/periods/${id}/drift`}>
              View period drift →
            </Link>
          ))}
        </div>
      )}

      {scope ? (
        <Card title="Grant scope" className="mb-6">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4" data-testid="grant-scope">
            <KeyFigure
              label="Grant"
              value={<Link href={`/grants/${scope.grant.id}`}>{scope.grant.name}</Link>}
              hint={reportMeta.title ?? undefined}
            />
            <KeyFigure
              label="Report range"
              value={<Period from={scope.dateFrom} to={scope.dateTo} />}
              hint={reportMeta.companyName ?? undefined}
            />
            <KeyFigure
              label="Member lines in range"
              value={scopeTotals ? scopeTotals.memberLines : '—'}
              hint={
                scopeTotals && scopeTotals.classes.length > 0
                  ? `Classes: ${scopeTotals.classes.join(', ')}`
                  : undefined
              }
            />
            <KeyFigure
              label="Income / expense"
              value={
                scopeTotals ? (
                  <>
                    <Money cents={scopeTotals.incomeCents} zero="zero" className="scope-income" />
                    {' / '}
                    <Money cents={scopeTotals.expenseCents} zero="zero" className="scope-expense" />
                  </>
                ) : (
                  '—'
                )
              }
            />
          </div>
          <p className="muted mt-3 text-xs">
            Only this grant&apos;s lines dated inside the report range were reconciled; other grants
            and the rest of the ledger were not touched.
          </p>
        </Card>
      ) : null}

      {checksums.length > 0 ? (
        <Card title="Checksums" className="mb-6">
          <DataTable caption="Report totals versus the lines under them">
            <thead>
              <tr>
                <th>Total row</th>
                <th className="num">Row</th>
                <th className="num">Report says</th>
                <th className="num">Lines add up to</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {checksums.map((c) => (
                <tr key={c.row} data-testid="checksum-row" data-passed={c.passed}>
                  <td>{c.label}</td>
                  <td className="num">{c.row}</td>
                  <td className="num">
                    <Money cents={c.expectedCents} zero="zero" />
                  </td>
                  <td className="num">
                    <Money cents={c.actualCents} zero="zero" />
                  </td>
                  <td>
                    <StatusPill tone={c.passed ? 'ok' : 'bad'}>
                      {c.passed ? 'Matches' : 'Mismatch'}
                    </StatusPill>
                  </td>
                </tr>
              ))}
            </tbody>
          </DataTable>
        </Card>
      ) : null}

      <div className="card mb-6">
        <h2 className="mb-3">Counts per entity</h2>
        <DataTable caption="Counts per entity">
          <thead>
            <tr>
              <th>Entity</th>
              <th className="num">New</th>
              <th className="num">Changed</th>
              <th className="num">Unchanged</th>
              <th className="num">Deleted</th>
            </tr>
          </thead>
          <tbody>
            {entities.map((e) => {
              const c = counts[e];
              return (
                <tr key={e}>
                  <td className="capitalize">{e}</td>
                  <td className="num">{c?.new ?? 0}</td>
                  <td className="num">{c?.changed ?? 0}</td>
                  <td className="num">{c?.unchanged ?? 0}</td>
                  <td className="num">{c?.deleted ?? 0}</td>
                </tr>
              );
            })}
          </tbody>
        </DataTable>
        <h2 className="mb-2 mt-5">File hashes</h2>
        <DataTable caption="File hashes">
          <tbody>
            {Object.entries(batch.fileHashes as Record<string, string>).map(([f, h]) => (
              <tr key={f}>
                <td>{f}</td>
                <td className="text-xs break-all">{h}</td>
              </tr>
            ))}
          </tbody>
        </DataTable>
      </div>

      {errors.length > 0 ? (
        <div className="card">
          <h2 className="mb-3">
            Errors ({errors.length}) — page {page} of {pages}
          </h2>
          <DataTable caption="Import errors">
            <thead>
              <tr>
                <th>File</th>
                <th className="num">Row</th>
                <th>Column</th>
                <th>Code</th>
                <th>Message</th>
              </tr>
            </thead>
            <tbody>
              {slice.map((e, i) => (
                <tr key={i}>
                  <td>{e.file}</td>
                  <td className="num">{e.row ?? ''}</td>
                  <td>{e.column ?? ''}</td>
                  <td className="text-xs">{e.code}</td>
                  <td>{e.message}</td>
                </tr>
              ))}
            </tbody>
          </DataTable>
          {pages > 1 ? (
            <div className="mt-3 flex gap-2 text-sm">
              {page > 1 ? (
                <Link href={`/import/${batch.id}?page=${page - 1}`}>← Previous</Link>
              ) : null}
              {page < pages ? (
                <Link href={`/import/${batch.id}?page=${page + 1}`}>Next →</Link>
              ) : null}
            </div>
          ) : null}
        </div>
      ) : null}
    </>
  );
}
