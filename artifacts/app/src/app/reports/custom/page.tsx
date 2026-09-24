import Link from 'next/link';
import { PageHeader } from '@/components/page-header';
import { prisma } from '@/lib/db';
import { getOrgId } from '@/lib/org';
import { dimensionLabels, dimensions, parseParams } from '@/reports/params';
import { loadReport } from '@/reports/query';
import { ReportTable } from '../table';
import { saveView } from '../actions';

export const dynamic = 'force-dynamic';
export default async function Custom({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const raw = await searchParams,
    p = parseParams(raw);
  const orgId = await getOrgId();
  const [{ org, run, facts }, grants, programs, accounts] = await Promise.all([
    loadReport(orgId, p),
    prisma.grant.findMany({ where: { orgId }, orderBy: { name: 'asc' } }),
    prisma.program.findMany({ where: { orgId }, orderBy: { code: 'asc' } }),
    prisma.account.findMany({ where: { orgId }, orderBy: { number: 'asc' } }),
  ]);
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(raw))
    for (const value of Array.isArray(v) ? v : v === undefined ? [] : [v])
      if (!['rowKey', 'colKey', 'pageKey'].includes(k)) q.append(k, value);
  const query = q.toString();
  const pages = p.page
    ? [...new Set(facts.map((f) => f[p.page!]))].sort((a, b) =>
        a.localeCompare(b, undefined, { numeric: true }),
      )
    : [undefined];
  return (
    <>
      <PageHeader
        title="Custom report"
        subtitle={
          run
            ? `Run ${(run.finishedAt ?? run.startedAt).toISOString().replace('T', ' ').slice(0, 19)} UTC`
            : 'No current run'
        }
        actions={
          <Link href="/reports" className="btn btn-secondary">
            All reports
          </Link>
        }
      />
      {run?.stale ? (
        <div className="banner banner-warn">
          Configuration changed since the current run. Reports show numbers from{' '}
          {(run.finishedAt ?? run.startedAt).toISOString().replace('T', ' ').slice(0, 19)} UTC until
          you recompute.
        </div>
      ) : null}
      {!run ? (
        <div className="banner banner-warn">
          No current run — recompute on <Link href="/runs">/runs</Link>.
        </div>
      ) : null}
      <div className="card">
        <form action="/reports/custom">
          <div className="grid-form">
            <label>
              Rows{' '}
              <select name="rows" defaultValue={p.rows}>
                {dimensions.map((d) => (
                  <option key={d} value={d}>
                    {dimensionLabels[d]}
                  </option>
                ))}
              </select>
            </label>{' '}
            <label>
              Columns{' '}
              <select name="cols" defaultValue={p.cols}>
                {dimensions.map((d) => (
                  <option key={d} value={d}>
                    {dimensionLabels[d]}
                  </option>
                ))}
              </select>
            </label>{' '}
            <label>
              Page break{' '}
              <select name="page" defaultValue={p.page ?? ''}>
                <option value="">None</option>
                {dimensions.map((d) => (
                  <option key={d} value={d}>
                    {dimensionLabels[d]}
                  </option>
                ))}
              </select>
            </label>{' '}
            <label>
              From <input type="date" name="from" defaultValue={p.from} />
            </label>{' '}
            <label>
              To <input type="date" name="to" defaultValue={p.to} />
            </label>{' '}
            <label>
              Grant{' '}
              <select name="grant" defaultValue={p.grant[0] ?? ''}>
                <option value="">All</option>
                {grants.map((g) => (
                  <option key={g.id} value={g.id}>
                    {g.awardNumber ?? g.name}
                  </option>
                ))}
              </select>
            </label>{' '}
            <label>
              Program{' '}
              <select name="program" defaultValue={p.program[0] ?? ''}>
                <option value="">All</option>
                {programs.map((g) => (
                  <option key={g.id} value={g.id}>
                    {g.code}
                  </option>
                ))}
              </select>
            </label>{' '}
            <label>
              Account{' '}
              <select name="account" defaultValue={p.account[0] ?? ''}>
                <option value="">All</option>
                {accounts.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.number} {a.name}
                  </option>
                ))}
              </select>
            </label>{' '}
          </div>
          <div
            style={{
              display: 'flex',
              flexWrap: 'wrap',
              gap: 16,
              alignItems: 'center',
              marginTop: 12,
            }}
          >
            <label>
              <input type="checkbox" name="restricted" value="1" defaultChecked={p.restricted} />{' '}
              Restricted only
            </label>{' '}
            <label>
              <input type="checkbox" name="unmapped" value="1" defaultChecked={p.unmapped} />{' '}
              Include unmapped
            </label>{' '}
            <input type="hidden" name="unmapped" value="0" />
            <label>
              <input type="checkbox" name="zeros" value="1" defaultChecked={p.zeros} /> Show zero
              rows
            </label>{' '}
            {p.run ? <input type="hidden" name="run" value={p.run} /> : null}
            <button className="btn" type="submit">
              Build report
            </button>
          </div>
        </form>
      </div>
      {run ? (
        <>
          <p>
            <Link href={`/reports/export/csv?${query}`}>Download CSV</Link> ·{' '}
            <Link href={`/reports/export/xlsx?${query}`}>Download XLSX</Link> ·{' '}
            <Link href={`/reports/export/pdf?${query}`}>Download PDF</Link>
          </p>
          <form action={saveView} style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <input type="hidden" name="query" value={query} />
            <label>
              Save current view <input name="name" required placeholder="View name" />
            </label>{' '}
            <button className="btn btn-secondary btn-sm">Save view</button>
          </form>
          {pages.map((k) => (
            <ReportTable key={k ?? '_'} facts={facts} params={p} query={query} pageKey={k} />
          ))}
        </>
      ) : null}
    </>
  );
}
