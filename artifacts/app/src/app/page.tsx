import Link from 'next/link';
import { Banner, FilterBar, PageHeader, PeriodSubtitle } from '@/components/ui';
import { CloseChecklist, ClosedBanner } from '@/components/close-checklist';
import {
  FlaggedGrantsCard,
  HealthChecksCard,
  RestrictedBalancesCard,
} from '@/components/overview-cards';
import { TERMS } from '@/copy/terms';
import { formatDate } from '@/domain/format';
import { getOrgId } from '@/lib/org';
import { currentPeriod } from '@/lib/period';
import { loadCloseStatus } from '@/services/close-status';

export const dynamic = 'force-dynamic';

/**
 * Home = the month-end close checklist (JPH-28 D2). Seven steps in the order the CPA works
 * through them; the numbers behind each step update by themselves after every change.
 */
export default async function ClosePage({
  searchParams,
}: {
  searchParams: Promise<{ asOf?: string }>;
}) {
  const orgId = await getOrgId();
  const period = await currentPeriod(orgId, await searchParams);
  const { label, date, booksThrough: coverage, range } = period;
  const { status, dashboard, failedRun } = await loadCloseStatus(orgId, period);
  const through = formatDate(date);
  return (
    <>
      <PageHeader
        title={TERMS.closeChecklist}
        subtitle={<PeriodSubtitle from={range.from} to={date} booksThrough={coverage} />}
        secondaryActions={<Link href={`/reports/overview?asOf=${label}`}>Overview →</Link>}
      />
      {coverage && date > coverage && (
        <Banner tone="warn">
          As of {formatDate(date)} is after the last imported transaction ({formatDate(coverage)});
          pacing will look under pace until newer books are imported.
        </Banner>
      )}
      {failedRun ? (
        <div className="banner banner-bad" data-testid="failed-calculation-blocker">
          <strong>Update failed.</strong> The last change could not be calculated
          {failedRun.cause ? ` (${failedRun.cause})` : ''}; the numbers below are from the previous
          calculation. <Link href={`/runs/${failedRun.id}`}>See the failed calculation →</Link>
        </div>
      ) : null}
      <FilterBar>
        <label htmlFor="dashboard-as-of">As of</label>
        <input id="dashboard-as-of" name="asOf" type="date" defaultValue={label} />
      </FilterBar>
      {status.closed ? (
        <ClosedBanner through={through} reportsHref={`/reports?asOf=${label}`} />
      ) : null}
      <CloseChecklist
        steps={status.steps}
        open={status.open}
        details={{
          budgets: (
            <div className="space-y-4">
              <div className="grid items-start gap-4 md:grid-cols-2">
                <RestrictedBalancesCard data={dashboard} label={label} />
                <FlaggedGrantsCard data={dashboard} label={label} />
              </div>
              <HealthChecksCard data={dashboard} range={range} />
              <p className="muted text-sm">
                The full set of cards is on the{' '}
                <Link href={`/reports/overview?asOf=${label}`}>overview</Link>.
              </p>
            </div>
          ),
        }}
      />
    </>
  );
}
