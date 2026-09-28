import Link from 'next/link';
import {
  Button,
  Card,
  DataTable,
  DateText,
  PageHeader,
  Period,
  StatusPill,
  Th,
} from '@/components/ui';
import { prisma } from '@/lib/db';
import { getOrgId } from '@/lib/org';
import type { ImportCounts } from '@/datasource/import-service';
import { uploadCsvBundle } from './actions';
import { uploadQboReport } from './qbo-report/actions';

export const dynamic = 'force-dynamic';

export default async function ImportPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;
  const orgId = await getOrgId();
  const [batches, grants] = await Promise.all([
    prisma.importBatch.findMany({
      where: { orgId },
      orderBy: { startedAt: 'desc' },
      take: 10,
      include: { scopeGrant: { select: { name: true } } },
    }),
    prisma.grant.findMany({
      where: { orgId, status: { in: ['draft', 'active'] } },
      orderBy: { name: 'asc' },
      select: { id: true, name: true, funder: true },
    }),
  ]);

  return (
    <>
      <PageHeader
        title="Import"
        subtitle="Upload a QuickBooks-shaped CSV bundle. Imports are all-or-nothing: any error and nothing is written."
      />
      {error ? <div className="banner banner-bad">{error}</div> : null}

      <Card title="Upload CSV bundle">
        <form action={uploadCsvBundle} className="mb-6">
          <div className="grid-form">
            <div className="md:col-span-2">
              <label htmlFor="files">
                Files (company, accounts, classes, locations, names, transactions; optional
                trial_balance)
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
          <Button>Import</Button>
        </form>
      </Card>

      <Card title="Import a QuickBooks report for one grant">
        <form action={uploadQboReport} className="mb-6" encType="multipart/form-data">
          <div className="grid-form">
            <div>
              <label htmlFor="report">Transaction Detail by Account export (.xlsx or .csv)</label>
              <input
                id="report"
                name="report"
                type="file"
                accept=".xlsx,.csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv"
                required
              />
            </div>
            <div>
              <label htmlFor="grantId">Grant</label>
              <select id="grantId" name="grantId" required defaultValue="">
                <option value="" disabled>
                  Choose a grant…
                </option>
                {grants.map((g) => (
                  <option key={g.id} value={g.id}>
                    {g.name} — {g.funder}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="sheet">Worksheet (optional, .xlsx only)</label>
              <input id="sheet" name="sheet" type="text" placeholder="First sheet if blank" />
            </div>
          </div>
          <p className="muted mt-2 text-xs">
            Run the report in QuickBooks filtered to the grant&apos;s class or customer with a fixed
            date range, export it, and upload it here. You will see what was read and whether every
            total checks out before anything is written.
          </p>
          <Button disabled={grants.length === 0}>Review report</Button>
          {grants.length === 0 ? (
            <p className="muted mt-2 text-xs">
              Create a grant first — a report import always belongs to one grant.
            </p>
          ) : null}
        </form>
      </Card>

      <Card title="Recent imports">
        {batches.length === 0 ? (
          <p className="muted">
            No imports yet. Try the demo data: npm run import:csv -- --dir fixtures/demo
          </p>
        ) : (
          <DataTable caption="Recent import batches">
            <thead>
              <tr>
                <th>Started</th>
                <th>Source</th>
                <th>Status</th>
                <th>Range</th>
                <th className="num">Txns new / changed / unchanged / deleted</th>
                <th className="num">Lines</th>
                <th className="num">Errors</th>
                <Th>Details</Th>
              </tr>
            </thead>
            <tbody>
              {batches.map((b) => {
                const c = b.counts as Partial<ImportCounts>;
                const t = c.transactions;
                return (
                  <tr key={b.id}>
                    <td>
                      <DateText date={b.startedAt} time />
                    </td>
                    <td>
                      {b.sourceSystem}
                      {b.scopeGrant ? <span className="muted"> · {b.scopeGrant.name}</span> : null}
                    </td>
                    <td>
                      <StatusPill
                        tone={
                          b.status === 'succeeded' ? 'ok' : b.status === 'failed' ? 'bad' : 'warn'
                        }
                      >
                        {b.status.charAt(0).toUpperCase() + b.status.slice(1)}
                      </StatusPill>
                    </td>
                    <td>
                      {b.fullRange ? (
                        'Full range'
                      ) : b.rangeFrom && b.rangeTo ? (
                        <Period from={b.rangeFrom} to={b.rangeTo} />
                      ) : (
                        '—'
                      )}
                    </td>
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
          </DataTable>
        )}
      </Card>
    </>
  );
}
