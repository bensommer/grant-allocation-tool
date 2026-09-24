import Link from 'next/link';
import { PageHeader } from '@/components/page-header';
import { prisma } from '@/lib/db';
import { getOrgId } from '@/lib/org';
import type { ImportCounts } from '@/datasource/import-service';
import { uploadCsvBundle } from './actions';
import { BatchStatusPill } from './status-pill';

export const dynamic = 'force-dynamic';

export default async function ImportPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;
  const orgId = await getOrgId();
  const batches = await prisma.importBatch.findMany({
    where: { orgId },
    orderBy: { startedAt: 'desc' },
    take: 10,
  });

  return (
    <>
      <PageHeader
        title="Import"
        subtitle="Upload a QuickBooks-shaped CSV bundle. Imports are all-or-nothing: any error and nothing is written."
      />
      {error ? <div className="banner banner-bad">{error}</div> : null}

      <form
        action={uploadCsvBundle}

        className="card mb-6"
      >
        <h2 className="mb-3">Upload CSV bundle</h2>
        <div className="grid-form">
          <div className="md:col-span-2">
            <label htmlFor="files">
              Files (company, accounts, classes, locations, parties, transactions)
            </label>
            <input id="files" name="files" type="file" accept=".csv,text/csv" multiple required />
          </div>
          <div>
            <label htmlFor="from">From (optional)</label>
            <input id="from" name="from" type="text" placeholder="YYYY-MM-DD" />
          </div>
          <div>
            <label htmlFor="to">To (optional)</label>
            <input id="to" name="to" type="text" placeholder="YYYY-MM-DD" />
          </div>
        </div>
        <p className="muted mt-2 text-xs">
          Leave dates blank for a full import: transactions missing from the files are marked
          deleted. With a date range, only transactions inside the range are reconciled.
        </p>
        <button type="submit" className="btn mt-3">
          Import
        </button>
      </form>

      <div className="card">
        <h2 className="mb-3">Recent imports</h2>
        {batches.length === 0 ? (
          <p className="muted">
            No imports yet. Try the demo data:{' '}
            <code>npm run import:csv -- --dir fixtures/demo</code>
          </p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Started</th>
                <th>Source</th>
                <th>Status</th>
                <th>Range</th>
                <th className="num">Txns new / changed / unchanged / deleted</th>
                <th className="num">Lines</th>
                <th className="num">Errors</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {batches.map((b) => {
                const c = b.counts as Partial<ImportCounts>;
                const t = c.transactions;
                return (
                  <tr key={b.id}>
                    <td>{b.startedAt.toISOString().replace('T', ' ').slice(0, 19)}</td>
                    <td>{b.sourceSystem}</td>
                    <td>
                      <BatchStatusPill status={b.status} />
                    </td>
                    <td>{b.fullRange ? 'full' : `${iso(b.rangeFrom)} → ${iso(b.rangeTo)}`}</td>
                    <td className="num">
                      {t ? `${t.new} / ${t.changed} / ${t.unchanged} / ${t.deleted}` : '–'}
                    </td>
                    <td className="num">{c.lines ?? '–'}</td>
                    <td className="num">{(b.errors as unknown[]).length}</td>
                    <td>
                      <Link href={`/import/${b.id}`}>Detail</Link>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
}

function iso(d: Date | null): string {
  return d ? d.toISOString().slice(0, 10) : '';
}
