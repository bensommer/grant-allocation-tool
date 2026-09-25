import Link from 'next/link';
import { StaleRunBanner } from '@/components/stale-run-banner';
import { notFound } from 'next/navigation';
import {
  Banner,
  ButtonLink,
  Card,
  DataTable,
  DateText,
  FilterBar,
  KeyFigure,
  LinkCell,
  Money,
  Month,
  NumTd,
  PageHeader,
  ProgressBar,
  Th,
  Td,
  Toolbar,
  TotalRow,
} from '@/components/ui';
import { GrantPaceStatus } from '@/components/grant-pace-status';
import { type YearMonth } from '@/domain/format';
import { getOrgId } from '@/lib/org';
import { bvaData, defaultReportDate } from '@/services/bva';
import { GrantTabs } from '../tabs';
import { grantMonths } from './months';

export const dynamic = 'force-dynamic';

export default async function BvaPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ asOf?: string; months?: string }>;
}) {
  const { id } = await params;
  const query = await searchParams;
  const { date, label } = await defaultReportDate(await getOrgId(), query.asOf);
  const { run, grants } = await bvaData(await getOrgId(), date, id);
  const grant = grants[0];
  if (!grant) notFound();
  const all = query.months === 'all';
  const months = grantMonths(grant.startDate, grant.endDate, date, all) as YearMonth[];
  const future = (month: string) => month > label.slice(0, 7);
  const drill = (lineCode: string, month?: string) => {
    const q = new URLSearchParams({
      run: run?.id ?? '',
      grant: id,
      from: month ? `${month}-01` : grant.startDate.toISOString().slice(0, 10),
      to: month
        ? `${month}-${new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0)).getUTCDate()}`
        : label,
      rows: 'grantBudgetLine',
      cols: month ? 'month' : 'grant',
      rowKey: lineCode,
      colKey: month ?? grant.awardNumber ?? grant.name,
    });
    return `/reports/lines?${q}`;
  };
  return (
    <>
      <PageHeader
        title={`${grant.name} · Budget vs actual`}
        subtitle={
          <>
            As of <DateText date={date} /> · Current run:{' '}
            {run ? <DateText date={run.finishedAt ?? run.startedAt} time /> : 'none'}
          </>
        }
      />
      <GrantTabs id={id} active="bva" />
      <StaleRunBanner run={run} />
      {!run && (
        <Banner tone="warn">
          No current run — recompute on <Link href="/runs">Compute runs</Link>.
        </Banner>
      )}
      <FilterBar>
        <label htmlFor="bva-as-of">As of</label>
        <input id="bva-as-of" name="asOf" type="date" defaultValue={label} />
        {all && <input type="hidden" name="months" value="all" />}
      </FilterBar>
      <Toolbar>
        <ButtonLink variant="secondary" size="sm" href={`/grants/${id}/bva/csv?asOf=${label}`}>
          CSV
        </ButtonLink>
        <ButtonLink variant="secondary" size="sm" href={`/grants/${id}/bva/xlsx?asOf=${label}`}>
          XLSX
        </ButtonLink>
        <ButtonLink variant="secondary" size="sm" href={`/grants/${id}/bva/pdf?asOf=${label}`}>
          PDF
        </ButtonLink>
        <ButtonLink
          variant="secondary"
          size="sm"
          href={`/grants/${id}/bva?asOf=${label}${all ? '' : '&months=all'}`}
        >
          {all ? 'Hide future months' : 'Show all months'}
        </ButtonLink>
      </Toolbar>
      <DataTable caption="Budget vs actual by budget line and month" stickyFirstColumn>
        <thead>
          <tr>
            <Th>Budget line</Th>
            <Th num>Budget ($)</Th>
            <Th num>Actual ($)</Th>
            <Th num>Remaining ($)</Th>
            <Th num>Used</Th>
            {months.map((m) => (
              <Th num className="whitespace-nowrap" key={m}>
                <Month ym={m} context={months} />
              </Th>
            ))}
          </tr>
        </thead>
        <tbody>
          {grant.rows.map((r) => (
            <tr key={r.id}>
              <Td>
                {r.name}
                <span className="muted block text-sm">{r.code}</span>
              </Td>
              <NumTd cents={r.budgetCents} />
              <NumTd>
                <LinkCell href={drill(r.code)}>
                  <Money cents={r.actual} />
                </LinkCell>
              </NumTd>
              <NumTd cents={r.remaining} />
              <NumTd>
                <ProgressBar
                  used={r.actual}
                  budget={r.budgetCents}
                  label={`${r.name} budget used`}
                />
              </NumTd>
              {months.map((m) => (
                <NumTd key={m}>
                  {future(m) ? (
                    <span>—</span>
                  ) : (
                    <LinkCell href={drill(r.code, m)}>
                      <Money cents={r.monthly[m] ?? 0} />
                    </LinkCell>
                  )}
                </NumTd>
              ))}
            </tr>
          ))}
          <TotalRow>
            <Th scope="row">Total</Th>
            <NumTd cents={grant.budget} dollar data-testid="bva-budget" />
            <NumTd cents={grant.actual} dollar data-testid="bva-actual" />
            <NumTd cents={grant.remaining} dollar />
            <NumTd>
              <ProgressBar used={grant.actual} budget={grant.budget} label="Total budget used" />
            </NumTd>
            {months.map((m) => (
              <NumTd key={m}>
                {future(m) ? (
                  '—'
                ) : (
                  <Money cents={grant.rows.reduce((n, r) => n + (r.monthly[m] ?? 0), 0)} dollar />
                )}
              </NumTd>
            ))}
          </TotalRow>
        </tbody>
      </DataTable>
      <Card title="Pacing">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <KeyFigure
            label="Expected"
            value={<Money cents={grant.pace.expectedCents} dollar />}
            hint={`${grant.pace.elapsedDays} of ${grant.pace.totalDays} days`}
          />
          <KeyFigure label="Actual" value={<Money cents={grant.actual} dollar />} />
          <KeyFigure
            label="Variance"
            value={<Money cents={grant.pace.varianceCents} dollar />}
            hint={grant.pace.variancePct}
          />
          <KeyFigure
            label="Status"
            value={
              <GrantPaceStatus
                pace={grant.pace}
                paced={grant.figures.paced}
                overBudgetLines={grant.rows.filter((r) => r.overBudget).map((r) => r.name)}
              />
            }
          />
        </div>
        <p>
          Received <Money cents={grant.received} dollar data-testid="bva-received" /> · Restricted
          balance <Money cents={grant.balance} dollar data-testid="bva-balance" />
        </p>
      </Card>
      <p className="muted mt-4 text-sm">
        Actual: current-run expense allocations to budget lines within the grant period through
        as-of. Remaining = budget − actual. Received: matching income source lines in the grant
        period; restricted balance = received − actual. Expected = award × inclusive elapsed days /
        inclusive total days, rounded half-up. Any over-budget line is flagged.
      </p>
    </>
  );
}
