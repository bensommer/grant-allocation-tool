import Link from 'next/link';
import { notFound } from 'next/navigation';
import { StaleRunBanner } from '@/components/stale-run-banner';
import {
  Banner,
  ButtonLink,
  Card,
  DateText,
  FilterBar,
  KeyFigure,
  Money,
  PageHeader,
  PeriodSubtitle,
  Toolbar,
} from '@/components/ui';
import { GrantPaceStatus } from '@/components/grant-pace-status';
import { PacingCallout } from '@/components/pacing-callout';
import { TERMS } from '@/copy/terms';
import { type YearMonth } from '@/domain/format';
import { getOrgId } from '@/lib/org';
import { currentPeriod } from '@/lib/period';
import { bvaData } from '@/services/bva';
import { budgetTree } from '@/services/grant-budget';
import { grantHeader, workingView } from '@/services/grant-workspace';
import { EditGrantButton } from '@/app/grants/[id]/edit-grant-button';
import { GrantTabs } from '../tabs';
import { ForecastStrip } from './forecast-strip';
import { FunderTable, InternalTable, MonthlyTable } from './tables';
import { grantMonths } from './months';
import { bvaQuery, bvaView, type BvaView } from './view';

export const dynamic = 'force-dynamic';

/**
 * The one Budget vs. Actuals page (JPH-29 E2). Two server-rendered controls: Funder view
 * (budget as awarded) / Internal view (how we track it), and Totals / By month. `/funder` and
 * `/working` redirect here.
 */
export default async function BvaPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const { id } = await params;
  const sp = await searchParams;
  const orgId = await getOrgId();
  const view = bvaView(sp.view);
  const byMonth = sp.mode === 'months';
  const all = sp.months === 'all';
  const period = await currentPeriod(orgId, sp);
  const { date, label } = period;
  const [{ run, grants }, header, tree] = await Promise.all([
    bvaData(orgId, date, id),
    grantHeader(orgId, id),
    budgetTree(orgId, id, date),
  ]);
  const grant = grants[0];
  if (!grant || !header) notFound();
  const months = grantMonths(grant.startDate, grant.endDate, date, all) as YearMonth[];
  const working = workingView(tree, header, date);
  const base = `/grants/${id}/bva`;
  const href = (patch: Record<string, string | undefined>) => `${base}?${bvaQuery(sp, patch)}`;
  const exportQuery = new URLSearchParams({ asOf: label, view }).toString();
  const views: Array<{ key: BvaView; label: string; hint: string }> = [
    { key: 'funder', label: TERMS.funderView, hint: 'the categories on the award letter' },
    { key: 'internal', label: TERMS.internalView, hint: 'your working lines' },
  ];
  return (
    <>
      <PageHeader
        title={`${grant.name} · ${TERMS.budgetVsActuals}`}
        subtitle={
          <>
            <PeriodSubtitle from={period.range.from} to={date} booksThrough={period.booksThrough} />{' '}
            · Current run: {run ? <DateText date={run.finishedAt ?? run.startedAt} time /> : 'none'}
          </>
        }
        secondaryActions={<EditGrantButton id={id} />}
      />
      <GrantTabs id={id} active="bva" />
      <StaleRunBanner run={run} />
      {!run && (
        <Banner tone="warn">
          No current run — recompute on <Link href="/runs">Compute runs</Link>.
        </Banner>
      )}

      <div className="mb-3 flex flex-wrap items-center gap-x-6 gap-y-2">
        <nav className="segmented" aria-label="View" data-testid="bva-view-toggle" data-view={view}>
          {views.map((v) => (
            <Link
              key={v.key}
              href={href({ view: v.key })}
              aria-current={v.key === view ? 'page' : undefined}
              data-testid={`bva-view-${v.key}`}
              className={v.key === view ? 'is-active' : undefined}
            >
              {v.label}
            </Link>
          ))}
        </nav>
        <nav className="segmented" aria-label="Rows" data-testid="bva-mode-toggle">
          <Link
            href={href({ mode: undefined })}
            aria-current={!byMonth ? 'page' : undefined}
            data-testid="bva-mode-totals"
            className={!byMonth ? 'is-active' : undefined}
          >
            Totals
          </Link>
          <Link
            href={href({ mode: 'months' })}
            aria-current={byMonth ? 'page' : undefined}
            data-testid="bva-mode-months"
            className={byMonth ? 'is-active' : undefined}
          >
            By month
          </Link>
        </nav>
      </div>
      <p className="muted mb-3 text-sm" data-testid="bva-explainer">
        Funder view shows the categories on the award letter. Internal view shows your working
        lines, which roll up into them.
      </p>

      <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
        <FilterBar>
          <label htmlFor="bva-as-of">As of</label>
          <input id="bva-as-of" name="asOf" type="date" defaultValue={label} />
          <input type="hidden" name="view" value={view} />
          {byMonth && <input type="hidden" name="mode" value="months" />}
          {all && <input type="hidden" name="months" value="all" />}
        </FilterBar>
        <Toolbar>
          <ButtonLink
            variant="secondary"
            size="sm"
            href={`${base}/csv?${exportQuery}`}
            data-testid="bva-export-csv"
          >
            CSV
          </ButtonLink>
          <ButtonLink
            variant="secondary"
            size="sm"
            href={`${base}/xlsx?${exportQuery}`}
            data-testid="bva-export-xlsx"
          >
            XLSX
          </ButtonLink>
          <ButtonLink
            variant="secondary"
            size="sm"
            href={`${base}/pdf?${exportQuery}`}
            data-testid="bva-export-pdf"
          >
            PDF
          </ButtonLink>
          {byMonth && (
            <ButtonLink
              variant="secondary"
              size="sm"
              href={href({ months: all ? undefined : 'all' })}
            >
              {all ? 'Hide future months' : 'Show all months'}
            </ButtonLink>
          )}
        </Toolbar>
      </div>

      {byMonth ? (
        <MonthlyTable
          id={id}
          grant={grant}
          tree={tree}
          view={view}
          months={months}
          label={label}
          run={run}
        />
      ) : view === 'funder' ? (
        <FunderTable tree={tree} date={date} />
      ) : (
        <InternalTable tree={tree} view={working} date={date} />
      )}
      {!byMonth && (
        <>
          <span hidden data-testid="bva-budget" data-cents={grant.budget} />
          <span hidden data-testid="bva-actual" data-cents={grant.actual} />
        </>
      )}

      <Card title="Pacing">
        {view === 'internal' && (
          <div className="mb-3">
            <PacingCallout figures={grant.figures} />
          </div>
        )}
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
      {view === 'internal' && <ForecastStrip id={id} tree={tree} grant={header} sp={sp} />}
      <p className="muted mt-4 text-sm">
        Actual: current-run expense allocations to budget lines within the grant period through
        as-of. Remaining = budget − actual. Received: matching income transactions in the grant
        period; restricted balance = received − actual. Expected = award × inclusive elapsed days /
        inclusive total days, rounded half-up. Any over-budget line is flagged.
      </p>
    </>
  );
}
