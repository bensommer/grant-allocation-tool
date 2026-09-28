import Link from 'next/link';
import { notFound } from 'next/navigation';
import {
  Banner,
  Card,
  DataTable,
  DateText,
  KeyFigure,
  LinkCell,
  Money,
  NumTd,
  PageHeader,
  Period,
  ProgressBar,
  Td,
  Th,
  TotalRow,
} from '@/components/ui';
import { PacingCallout } from '@/components/pacing-callout';
import type { GrantFigures } from '@/domain/grant-figures';
import { TERMS } from '@/copy/terms';
import { prisma } from '@/lib/db';
import { getOrgId } from '@/lib/org';
import { currentPeriod } from '@/lib/period';
import { bvaData, defaultReportDate } from '@/services/bva';
import { budgetTree } from '@/services/grant-budget';
import { tieOut } from '@/services/grant-workspace';
import { grantTodo } from '@/services/grant-todo';
import { EditGrantButton } from '@/app/grants/[id]/edit-grant-button';
import { ActivityGridCard } from './(setup)/activity/activity-grid';
import { GrantTabs } from './tabs';
import { TieOutPanel } from './tie-out-panel';

export const dynamic = 'force-dynamic';

export default async function GrantPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ saved?: string; archived?: string; asOf?: string }>;
}) {
  const { id } = await params;
  const { saved, archived, asOf } = await searchParams;
  const orgId = await getOrgId();
  const { date, label } = await defaultReportDate(orgId, asOf);
  const [{ grants }, programs, activities, period] = await Promise.all([
    bvaData(orgId, date, id),
    prisma.program.findMany({ where: { orgId }, select: { id: true, name: true } }),
    prisma.grantActivity.count({ where: { grantId: id } }),
    currentPeriod(orgId, { asOf }),
  ]);
  const grant = grants[0];
  if (!grant) notFound();
  // The tie-out reconciles member lines; a crosswalk-tracked grant has none.
  const [tie, todo, tree] = await Promise.all([
    grant.mode === 'membership' ? tieOut(orgId, id) : null,
    grantTodo(orgId, id, period),
    activities > 0 ? budgetTree(orgId, id, date) : null,
  ]);
  const { figures } = grant;
  const programNames = new Map(programs.map((p) => [p.id, p.name]));
  const matched = figures.receiptLines;
  return (
    <>
      <PageHeader
        title={grant.name}
        subtitle={
          <>
            {grant.funder} · <Period from={grant.startDate} to={grant.endDate} />
          </>
        }
        secondaryActions={<EditGrantButton id={id} />}
      />
      <GrantTabs id={id} active="detail" />
      {saved && <Banner tone="ok">Saved.</Banner>}
      {archived && (
        <Banner tone="warn">
          This grant appears in a past calculation, so it was archived rather than deleted.
        </Banner>
      )}
      <p className="mb-3 text-sm" data-testid="whats-next" data-open={todo.openCount}>
        <span className="font-semibold">What&apos;s next:</span>{' '}
        {todo.next ? (
          <>
            {todo.next.status}{' '}
            <Link href={todo.next.key === 'review' ? `/grants/${id}/todo` : todo.next.button.href}>
              {todo.next.key === 'review' ? 'Open To do' : todo.next.button.label}
            </Link>
          </>
        ) : (
          <>Nothing — this grant is up to date through {period.label}.</>
        )}
      </p>
      <div className="grid gap-4 md:grid-cols-2" data-testid="header-metrics">
        <Card>
          <KeyFigure
            label="Restricted balance"
            value={
              <Money cents={figures.restrictedBalanceCents} dollar data-testid="metric-balance" />
            }
            hint="Received − spent"
            lead
          />
        </Card>
        <Card>
          <KeyFigure
            label="Spent vs. budget"
            value={
              <>
                <Money cents={figures.spentCents} dollar data-testid="metric-spent" />
                <span className="muted text-base font-normal">
                  {' '}
                  of <Money cents={figures.awardCents} dollar data-testid="metric-award" />
                </span>
              </>
            }
            hint={
              <PacingCallout
                figures={figures}
                overBudgetLines={grant.rows.filter((r) => r.overBudget).map((r) => r.name)}
              />
            }
            lead
          />
        </Card>
      </div>
      <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Card>
          <KeyFigure
            label="Received"
            value={<Money cents={figures.receivedCents} dollar data-testid="metric-received" />}
            hint="Grant income lines through the report date"
            quiet
          />
        </Card>
        <Card>
          <KeyFigure
            label="Remaining award"
            value={
              <Money cents={figures.remainingAwardCents} dollar data-testid="metric-remaining" />
            }
            hint="Award − spent"
            quiet
          />
        </Card>
        <Card>
          <KeyFigure
            label="Projected at grant end"
            value={
              figures.projectedAtEndCents === null ? (
                <span className="muted">—</span>
              ) : (
                <Money cents={figures.projectedAtEndCents} dollar />
              )
            }
            hint="Straight line from the spend rate to date"
            quiet
          />
        </Card>
        <Card>
          <KeyFigure
            label="Spent"
            value={<Money cents={figures.spentCents} dollar />}
            hint={
              grant.mode === 'membership'
                ? 'Assigned transactions + effort charges through the report date'
                : 'Crosswalk allocated amounts inside the grant period through the report date'
            }
            quiet
          />
        </Card>
      </div>
      <Card title="Tie-out">
        {tie ? (
          <TieOutPanel id={id} tieOut={tie} />
        ) : (
          <p className="muted text-sm" data-testid="tie-out-crosswalk">
            Tracked by crosswalk rules — review queue does not apply. Spent{' '}
            <Money cents={figures.spentCents} dollar data-testid="tie-charged" /> is the sum of the
            budget lines below.
          </p>
        )}
      </Card>
      <Card
        title={TERMS.budgetVsActuals}
        action={
          <span className="flex flex-wrap gap-3 text-sm">
            <LinkCell href={`/grants/${id}/bva?view=funder&asOf=${label}`}>
              Funder view (budget as awarded) →
            </LinkCell>
            <LinkCell href={`/grants/${id}/bva?view=internal&asOf=${label}`}>
              Internal view (how we track it) →
            </LinkCell>
          </span>
        }
      >
        <DataTable stickyFirstColumn>
          <thead>
            <tr>
              <Th>Budget line</Th>
              <Th>Program</Th>
              <Th num>Budget ($)</Th>
              <Th num>Actual ($)</Th>
              <Th num>Remaining ($)</Th>
              <Th num>Used</Th>
            </tr>
          </thead>
          <tbody>
            {grant.rows.map((r) => (
              <tr key={r.id}>
                <Td>
                  {r.name}
                  <span className="muted block text-sm">{r.code}</span>
                </Td>
                <Td>{r.programId ? (programNames.get(r.programId) ?? 'Unknown program') : '—'}</Td>
                <NumTd cents={r.budgetCents} />
                <NumTd>
                  <LinkCell href={`/grants/${id}/bva?asOf=${label}`}>
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
              </tr>
            ))}
            <TotalRow>
              <Th scope="row" colSpan={2}>
                Total
              </Th>
              <NumTd cents={grant.budget} dollar />
              <NumTd cents={grant.actual} dollar />
              <NumTd cents={grant.remaining} dollar />
              <NumTd>
                <ProgressBar used={grant.actual} budget={grant.budget} label="Total budget used" />
              </NumTd>
            </TotalRow>
          </tbody>
        </DataTable>
      </Card>
      {tree ? <ActivityGridCard tree={tree} /> : null}
      <Card
        title="Pacing and forecast"
        action={
          <LinkCell href={`/grants/${id}/bva?view=internal&asOf=${label}#forecast`}>
            Plan the remaining months →
          </LinkCell>
        }
      >
        <ForecastStrip figures={figures} />
      </Card>
      <Card title="Receipts">
        {matched.length ? (
          <DataTable>
            <thead>
              <tr>
                <Th>Date</Th>
                <Th num>Received ($)</Th>
              </tr>
            </thead>
            <tbody>
              {matched.map((r) => (
                <tr key={r.id}>
                  <Td>
                    <DateText date={r.txnDate} />
                  </Td>
                  <NumTd cents={r.amountCents} />
                </tr>
              ))}
              <TotalRow>
                <Th scope="row">Total received</Th>
                <NumTd cents={grant.received} dollar />
              </TotalRow>
            </tbody>
          </DataTable>
        ) : (
          <p className="muted">No matching receipts through this date.</p>
        )}
      </Card>
    </>
  );
}

/**
 * The forecast half of "Pacing and forecast": what is left, how many months remain and what
 * that means per month. The pace itself (spent % vs. time %) is the header card's callout, so
 * it is not repeated here.
 */
function ForecastStrip({ figures }: { figures: GrantFigures }) {
  const remaining = figures.awardCents - figures.spentCents;
  const perMonth = figures.monthsLeft > 0 ? Math.round(remaining / figures.monthsLeft) : null;
  return (
    <div className="grid gap-4 sm:grid-cols-3" data-testid="pacing-strip">
      <KeyFigure
        label="Remaining"
        value={<Money cents={remaining} dollar data-testid="forecast-remaining" />}
        hint="Award − spent"
        quiet
      />
      <KeyFigure
        label="Months left"
        value={<span data-testid="forecast-months-left">{figures.monthsLeft}</span>}
        hint={
          <>
            Through <DateText date={figures.asOf} /> → end date
          </>
        }
        quiet
      />
      <KeyFigure
        label="Needed per month"
        value={
          perMonth === null ? (
            <span className="muted">—</span>
          ) : (
            <Money cents={perMonth} dollar data-testid="forecast-per-month" />
          )
        }
        hint={
          figures.projectedAtEndCents === null ? (
            'To spend the award by the end date'
          ) : (
            <>
              At the current pace, <Money cents={figures.projectedAtEndCents} dollar /> by the end
              date
            </>
          )
        }
        quiet
      />
    </div>
  );
}
