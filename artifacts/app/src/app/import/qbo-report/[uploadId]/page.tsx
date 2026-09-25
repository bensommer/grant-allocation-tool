import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import {
  Banner,
  Button,
  ButtonLink,
  Card,
  DataTable,
  KeyFigure,
  Money,
  PageHeader,
  Period,
  StatusPill,
} from '@/components/ui';
import { ACCOUNT_TYPE_FIELD_PREFIX, accountMapping } from '@/datasource/qbo-report/adapter';
import { parseQboReport } from '@/datasource/qbo-report/parser';
import { readReportGrid } from '@/datasource/qbo-report/read';
import { accountTypeSchema } from '@/datasource/types';
import { prisma } from '@/lib/db';
import { getOrgId } from '@/lib/org';
import { commitQboReport } from '../actions';

export const dynamic = 'force-dynamic';

const ACCOUNT_TYPE_LABEL: Record<string, string> = {
  Income: 'Income',
  OtherIncome: 'Other income',
  Expense: 'Expense',
  COGS: 'Cost of goods sold',
  OtherExpense: 'Other expense',
  Asset: 'Asset',
  Liability: 'Liability',
  Equity: 'Equity',
};

/**
 * Confirm step for a report import: what we parsed, whether every "Total for"
 * row checks out, and the account types we guessed. Committing runs the import.
 */
export default async function ConfirmQboReportPage({
  params,
}: {
  params: Promise<{ uploadId: string }>;
}) {
  const { uploadId } = await params;
  const orgId = await getOrgId();
  const upload = await prisma.qboReportUpload.findFirst({
    where: { id: uploadId, orgId },
    include: { grant: { select: { id: true, name: true, funder: true } } },
  });
  if (!upload) notFound();
  if (upload.batchId) redirect(`/import/${upload.batchId}`);

  let parseFailure: string | null = null;
  let grid: Awaited<ReturnType<typeof readReportGrid>> | null = null;
  try {
    grid = await readReportGrid(Buffer.from(upload.content), upload.fileName, {
      sheet: upload.sheetName,
    });
  } catch (err) {
    parseFailure = err instanceof Error ? err.message : String(err);
  }
  const report = grid ? parseQboReport(grid.rows, { fileName: upload.fileName }) : null;
  const mapping = report ? accountMapping(report) : [];
  const failedChecksums = report?.checksums.filter((c) => !c.passed) ?? [];
  const blockers: string[] = [];
  if (parseFailure) blockers.push(parseFailure);
  if (upload.consumedAt)
    blockers.push('This report is being imported right now; refresh in a moment to see the batch.');
  if (report && !report.dateRange)
    blockers.push(
      'The title rows do not include a date range (e.g. "March 13-September 22, 2026"). Re-run the report with a fixed date range.',
    );
  const canCommit =
    !!report && blockers.length === 0 && report.errors.length === 0 && failedChecksums.length === 0;

  const incomeCents = report
    ? report.lines
        .filter((l) => {
          const type = mapping.find((m) => m.externalId === l.accountPath.join(':'))?.type;
          return type === 'Income' || type === 'OtherIncome';
        })
        .reduce((a, l) => a + l.amountCents, 0)
    : 0;
  const expenseCents = report
    ? report.lines.reduce((a, l) => a + l.amountCents, 0) - incomeCents
    : 0;

  return (
    <>
      <PageHeader
        title="Confirm report import"
        subtitle={
          <>
            {upload.fileName}
            {upload.sheetName ? ` · sheet "${upload.sheetName}"` : ''} → grant{' '}
            <Link href={`/grants/${upload.grant.id}`}>{upload.grant.name}</Link>
          </>
        }
        secondaryActions={
          <ButtonLink variant="secondary" href="/import">
            Cancel
          </ButtonLink>
        }
      />

      {blockers.map((b) => (
        <Banner key={b} tone="bad">
          {b}
        </Banner>
      ))}

      <form action={commitQboReport}>
        <input type="hidden" name="uploadId" value={upload.id} />

        <Card title="What we read" className="mb-6">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3" data-testid="report-summary">
            <KeyFigure label="Company on report" value={report?.companyName ?? '—'} />
            <KeyFigure label="Report" value={report?.title ?? '—'} />
            <KeyFigure
              label="Date range"
              value={
                report?.dateRange ? (
                  <Period from={report.dateRange.from} to={report.dateRange.to} />
                ) : (
                  (report?.dateRangeText ?? '—')
                )
              }
              hint="Only this grant's lines inside this range are reconciled."
            />
            <KeyFigure label="Transaction lines" value={report?.lines.length ?? 0} />
            <KeyFigure label="Income on report" value={<Money cents={incomeCents} zero="zero" />} />
            <KeyFigure
              label="Expense on report"
              value={<Money cents={expenseCents} zero="zero" />}
            />
          </div>
          <p className="muted mt-3 text-xs">
            This import is read-only toward QuickBooks and scoped to{' '}
            <strong>{upload.grant.name}</strong>: lines that disappeared from the report are marked
            removed only if they were previously imported for this grant.
          </p>
        </Card>

        <Card title="Checksums" className="mb-6">
          {report && report.checksums.length > 0 ? (
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
                {report.checksums.map((c) => (
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
          ) : (
            <p className="muted">No total rows were found.</p>
          )}
          {failedChecksums.length > 0 ? (
            <div className="banner banner-bad mt-3">
              {failedChecksums.length} total row(s) do not match the lines under them. The export
              looks edited or truncated; nothing will be imported until it is re-run from
              QuickBooks.
            </div>
          ) : null}
        </Card>

        {report && report.errors.length > 0 ? (
          <Card title={`Problems (${report.errors.length})`} className="mb-6">
            <DataTable caption="Parse problems">
              <thead>
                <tr>
                  <th className="num">Row</th>
                  <th>Code</th>
                  <th>Message</th>
                </tr>
              </thead>
              <tbody>
                {report.errors.map((e, i) => (
                  <tr key={i}>
                    <td className="num">{e.row ?? ''}</td>
                    <td className="text-xs">{e.code}</td>
                    <td>{e.message}</td>
                  </tr>
                ))}
              </tbody>
            </DataTable>
          </Card>
        ) : null}

        <Card title="Accounts on the report" className="mb-6">
          <p className="muted mb-3 text-xs">
            Report exports do not say whether a heading is income or expense, so the type is
            inferred from the top-level heading. Correct any guess before importing; sub-accounts
            follow their parent unless set here.
          </p>
          <DataTable caption="Accounts and their inferred types">
            <thead>
              <tr>
                <th>Account</th>
                <th className="num">Lines</th>
                <th>Type</th>
              </tr>
            </thead>
            <tbody>
              {mapping.map((m) => (
                <tr key={m.externalId} data-testid="account-row">
                  <td style={{ paddingLeft: `${(m.path.length - 1) * 1.25 + 0.75}rem` }}>
                    {m.name}
                  </td>
                  <td className="num">{m.lineCount}</td>
                  <td>
                    <select
                      name={`${ACCOUNT_TYPE_FIELD_PREFIX}${m.externalId}`}
                      defaultValue={m.type}
                      aria-label={`Account type for ${m.path.join(' › ')}`}
                    >
                      {accountTypeSchema.options.map((t) => (
                        <option key={t} value={t}>
                          {ACCOUNT_TYPE_LABEL[t] ?? t}
                        </option>
                      ))}
                    </select>
                  </td>
                </tr>
              ))}
            </tbody>
          </DataTable>
        </Card>

        <div className="page-actions">
          <ButtonLink variant="secondary" href="/import">
            Cancel
          </ButtonLink>
          <Button disabled={!canCommit}>Import into {upload.grant.name}</Button>
        </div>
      </form>
    </>
  );
}
