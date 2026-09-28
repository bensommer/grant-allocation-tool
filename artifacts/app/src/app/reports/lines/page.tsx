import { TERMS } from '@/copy/terms';
import Link from 'next/link';
import { StaleRunBanner } from '@/components/stale-run-banner';
import {
  Banner,
  ButtonLink,
  Card,
  DataTable,
  DateText,
  NumTd,
  PageHeader,
  Th,
  TotalRow,
} from '@/components/ui';
import { getOrgId } from '@/lib/org';
import { loadReport } from '@/reports/query';
import { parseParams } from '@/reports/params';
import { mappingKinds } from '@/reports/view';
export const dynamic = 'force-dynamic';
export default async function Lines({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const raw = await searchParams,
    p = parseParams(raw);
  const { run, facts } = await loadReport(await getOrgId(), p);
  const inGroup = mappingKinds.find((m) => m.kind === p.group)?.match ?? (() => true);
  const filtered = facts.filter(
    (f) =>
      f[p.rows] === p.rowKey &&
      f[p.cols] === p.colKey &&
      (!p.page || !p.pageKey || f[p.page] === p.pageKey) &&
      inGroup(f),
  );
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(raw))
    if (!['rowKey', 'colKey', 'pageKey', 'group'].includes(k))
      for (const s of Array.isArray(v) ? v : v ? [v] : []) q.append(k, s);
  return (
    <>
      <PageHeader
        title={`${facts.find((f) => f[p.rows] === p.rowKey)?.labels?.[p.rows] ?? p.rowKey ?? ''} × ${facts.find((f) => f[p.cols] === p.colKey)?.labels?.[p.cols] ?? p.colKey ?? ''}`}
        subtitle={
          run ? (
            <>
              Run <DateText date={run.finishedAt ?? run.startedAt} time /> — {filtered.length}{' '}
              {TERMS.allocatedAmountsLower}
            </>
          ) : (
            'No current run'
          )
        }
        secondaryActions={
          <ButtonLink variant="secondary" href={`/reports/custom?${q}`}>
            Back to report
          </ButtonLink>
        }
      />
      <StaleRunBanner run={run} />
      <Card>
        <DataTable caption="Report transactions">
          <thead>
            <tr>
              <Th>Date</Th>
              <th>Doc</th>
              <th>Description</th>
              <th>Program</th>
              <th>Grant</th>
              <th>Status</th>
              <th className="num">Amount</th>
              <th>Source</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((f) => (
              <tr key={f.pieceId}>
                <td>
                  <DateText date={new Date(`${f.date}T00:00:00Z`)} />
                </td>
                <td>{f.doc}</td>
                <td>{f.description}</td>
                <td>
                  {f.labels?.program ?? f.program}
                  <small className="muted"> · {f.program}</small>
                </td>
                <td>
                  {f.labels?.grant ?? f.grant}
                  <small className="muted"> · {f.grant}</small>
                </td>
                <td>{f.status}</td>
                <NumTd cents={f.amountCents} />
                <td>
                  <Link href={`/lines/${f.sourceLineId}`}>View line</Link>
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <TotalRow>
              <th colSpan={6}>Total</th>
              <NumTd cents={filtered.reduce((n, f) => n + f.amountCents, 0)} dollar />
              <td />
            </TotalRow>
          </tfoot>
        </DataTable>
      </Card>
    </>
  );
}
