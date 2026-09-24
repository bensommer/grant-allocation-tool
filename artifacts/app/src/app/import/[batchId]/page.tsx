import Link from 'next/link';
import { notFound } from 'next/navigation';
import { PageHeader } from '@/components/page-header';
import { prisma } from '@/lib/db';
import type { ImportCounts } from '@/datasource/import-service';
import type { ImportError } from '@/datasource/types';
import { BatchStatusPill } from '../status-pill';

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
  const batch = await prisma.importBatch.findUnique({ where: { id: batchId } });
  if (!batch) notFound();

  const counts = batch.counts as Partial<ImportCounts>;
  const errors = batch.errors as unknown as ImportError[];
  const page = Math.max(1, Number(pageRaw ?? '1') || 1);
  const pages = Math.max(1, Math.ceil(errors.length / PAGE_SIZE));
  const slice = errors.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  const entities = ['accounts', 'classes', 'locations', 'parties', 'transactions'] as const;

  return (
    <>
      <PageHeader
        title={`Import batch`}
        subtitle={`${batch.sourceSystem} · started ${batch.startedAt.toISOString().replace('T', ' ').slice(0, 19)}`}
        actions={
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
        <BatchStatusPill status={batch.status} />
        <span className="muted text-xs font-mono">{batch.id}</span>
      </div>

      {batch.status === 'failed' ? (
        <div className="banner banner-bad">
          Import failed with {errors.length} error(s). Nothing was written.
        </div>
      ) : batch.status === 'succeeded' ? (
        <div className="banner banner-ok">
          Succeeded — {counts.lines ?? 0} transaction lines in this batch.
        </div>
      ) : null}

      <div className="card mb-6">
        <h2 className="mb-3">Counts per entity</h2>
        <table>
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
        </table>
        <h2 className="mb-2 mt-5">File hashes</h2>
        <table>
          <tbody>
            {Object.entries(batch.fileHashes as Record<string, string>).map(([f, h]) => (
              <tr key={f}>
                <td>{f}</td>
                <td className="font-mono text-xs">{h}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {errors.length > 0 ? (
        <div className="card">
          <h2 className="mb-3">
            Errors ({errors.length}) — page {page} of {pages}
          </h2>
          <table>
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
                  <td className="font-mono text-xs">{e.code}</td>
                  <td>{e.message}</td>
                </tr>
              ))}
            </tbody>
          </table>
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
