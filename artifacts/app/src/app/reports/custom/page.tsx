import Link from 'next/link';
import { StaleRunBanner } from '@/components/stale-run-banner';
import { Button, ButtonLink, DateText, FilterBar, PageHeader, Toolbar } from '@/components/ui';
import { prisma } from '@/lib/db';
import { getOrgId } from '@/lib/org';
import { dimensionLabels, dimensions, parseParams } from '@/reports/params';
import { loadReport } from '@/reports/query';
import { ReportSections } from '../table';
import { saveView } from '../actions';
import { budgetColumnsNote, reportLayout, reportSections } from '@/reports/view';

export const dynamic = 'force-dynamic';
export default async function Custom({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const raw = await searchParams,
    p = parseParams(raw);
  const orgId = await getOrgId();
  const [{ run, facts, budgets }, grants, programs, accounts] = await Promise.all([
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
  const sections = reportSections(facts, p, budgets);
  return (
    <>
      <PageHeader
        title="Custom report"
        subtitle={
          run ? (
            <>
              Run <DateText date={run.finishedAt ?? run.startedAt} time />
            </>
          ) : (
            'No current run'
          )
        }
        secondaryActions={
          <ButtonLink href="/reports" variant="secondary">
            All reports
          </ButtonLink>
        }
      />
      <StaleRunBanner run={run} />
      {!run ? (
        <div className="banner banner-warn">
          No current run — recompute on <Link href="/runs">/runs</Link>.
        </div>
      ) : null}
      <FilterBar action="/reports/custom">
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
                  {g.name}
                  {g.awardNumber ? ` · ${g.awardNumber}` : ''}
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
                  {g.name} · {g.code}
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
            <input type="checkbox" name="unmapped" value="1" defaultChecked={p.unmapped} /> Include
            unmapped
          </label>{' '}
          <input type="hidden" name="unmapped" value="0" />
          <label>
            <input type="checkbox" name="zeros" value="1" defaultChecked={p.zeros} /> Show zero rows
          </label>{' '}
          {p.rows === 'grantBudgetLine' && (
            <label>
              <input type="checkbox" name="budget" value="1" defaultChecked={p.budget} /> Show
              budget, remaining and % for budget-line rows
            </label>
          )}
          {reportLayout(p) === 'single' && (
            <label>
              <input type="checkbox" name="mapping" value="1" defaultChecked={p.mapping} /> Group
              by mapping status
            </label>
          )}
          {p.run ? <input type="hidden" name="run" value={p.run} /> : null}
        </div>
      </FilterBar>
      {run ? (
        <>
          <Toolbar>
            <ButtonLink variant="secondary" size="sm" href={`/reports/export/csv?${query}`}>
              CSV
            </ButtonLink>
            <ButtonLink variant="secondary" size="sm" href={`/reports/export/xlsx?${query}`}>
              XLSX
            </ButtonLink>
            <ButtonLink variant="secondary" size="sm" href={`/reports/export/pdf?${query}`}>
              PDF
            </ButtonLink>
            <form action={saveView} className="flex flex-wrap items-end gap-2">
              <input type="hidden" name="query" value={query} />
              <label>
                Save current view <input name="name" required placeholder="View name" />
              </label>{' '}
              <Button variant="secondary" size="sm">
                Save
              </Button>
            </form>
          </Toolbar>
          {budgetColumnsNote(p) && (
            <p className="muted">
              Budget columns are shown when the report is broken by grant or not at all
            </p>
          )}
          <ReportSections sections={sections} params={p} query={query} />
        </>
      ) : null}
    </>
  );
}
