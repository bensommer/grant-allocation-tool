import Link from 'next/link';
import { StaleRunBanner } from '@/components/stale-run-banner';
import {
  Banner,
  Card,
  DateText,
  FilterBar,
  MiniBarChart,
  Money,
  Month,
  PageHeader,
  PeriodSubtitle,
} from '@/components/ui';
import {
  FlaggedGrantsCard,
  HealthChecksCard,
  NonGrantExpenseCard,
  RestrictedBalancesCard,
  UnmappedExpenseCard,
} from '@/components/overview-cards';
import { TERMS } from '@/copy/terms';
import { formatDate, formatMonth, type YearMonth } from '@/domain/format';
import { getOrgId } from '@/lib/org';
import { currentPeriod } from '@/lib/period';
import { dashboardData } from '@/services/dashboard';

export const dynamic = 'force-dynamic';

/**
 * The metrics dashboard that used to be the home page (JPH-28 D2). The cards are unchanged; the
 * home page is now the month-end close checklist and links here from step 3.
 */
export default async function OverviewPage({
  searchParams,
}: {
  searchParams: Promise<{ asOf?: string }>;
}) {
  const orgId = await getOrgId();
  const period = await currentPeriod(orgId, await searchParams);
  const { label, date, booksThrough: coverage, range } = period;
  const data = await dashboardData(orgId, period);
  const { run, lastImport, monthly, months } = data;
  const latestCounts = lastImport?.counts as { lockIds?: string[] } | undefined;
  const points = months.map((ym) => ({
    label: formatMonth(ym, {}, months),
    cents: monthly.get(ym)!,
  }));
  return (
    <>
      <PageHeader
        title="Overview"
        subtitle={
          <>
            <PeriodSubtitle from={period.range.from} to={date} booksThrough={coverage} /> · Current{' '}
            {TERMS.calculation.toLowerCase()}:{' '}
            <span data-volatile>
              {run ? <DateText date={run.finishedAt ?? run.startedAt} time /> : 'none'}
            </span>
          </>
        }
        secondaryActions={<Link href="/">Close checklist →</Link>}
      />
      {coverage && date > coverage && (
        <Banner tone="warn">
          As of {formatDate(date)} is after the last imported transaction ({formatDate(coverage)});
          pacing will look under pace until newer books are imported.
        </Banner>
      )}
      <StaleRunBanner run={run} />
      {!run && (
        <Banner tone="warn">
          No {TERMS.calculation.toLowerCase()} yet — import QuickBooks data or open the{' '}
          <Link href="/activity">activity log</Link>.
        </Banner>
      )}
      {!!latestCounts?.lockIds?.length && (
        <Banner tone="warn">
          A recent import changed a locked reporting period.{' '}
          {latestCounts.lockIds.map((id) => (
            <Link key={id} href={`/periods/${id}/drift`} className="mr-2">
              View period drift →
            </Link>
          ))}
        </Banner>
      )}
      <FilterBar>
        <label htmlFor="dashboard-as-of">As of</label>
        <input id="dashboard-as-of" name="asOf" type="date" defaultValue={label} />
      </FilterBar>
      <div className="grid items-start gap-4 md:grid-cols-2">
        <RestrictedBalancesCard data={data} label={label} />
        <FlaggedGrantsCard data={data} label={label} />
        <UnmappedExpenseCard data={data} />
        <NonGrantExpenseCard data={data} />
        <Card title="Activity" action={<Link href="/activity">Activity log →</Link>}>
          <p data-volatile>
            Last import:{' '}
            {lastImport ? (
              <>
                <DateText date={lastImport.finishedAt ?? lastImport.startedAt} time /> ·{' '}
                {lastImport.status}
              </>
            ) : (
              'None'
            )}
          </p>
          <p data-volatile>
            Last {TERMS.calculation.toLowerCase()}:{' '}
            {run ? (
              <>
                <DateText date={run.finishedAt ?? run.startedAt} time />
                {run.stale ? ` · ${TERMS.needsUpdate.toLowerCase()}` : ''}
              </>
            ) : (
              'None'
            )}
          </p>
        </Card>
        <Card title="Monthly expense">
          <MiniBarChart caption="Monthly total expense through as-of" points={points} />
          <ul className="mt-2 flex flex-wrap gap-x-4 text-sm">
            {months.map((ym) => (
              <li key={ym}>
                <Month ym={ym} context={months} />: <Money cents={monthly.get(ym)!} dollar />
              </li>
            ))}
          </ul>
        </Card>
      </div>
      <HealthChecksCard data={data} range={range} />
      <p className="muted mt-4 text-sm">
        Flagged means spending is outside configured straight-line pacing thresholds or a budget
        line is over budget. Totals use the current {TERMS.calculation.toLowerCase()}&apos;s expense
        allocations; income receipts are read from matching income transactions.
      </p>
    </>
  );
}
