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
import { prisma } from '@/lib/db';
import { getOrgId } from '@/lib/org';
import { bvaData, defaultReportDate } from '@/services/bva';
import { tieOut } from '@/services/grant-workspace';
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
  const [{ grants }, programs] = await Promise.all([
    bvaData(orgId, date, id),
    prisma.program.findMany({ where: { orgId }, select: { id: true, name: true } }),
  ]);
  const grant = grants[0];
  if (!grant) notFound();
  // The tie-out reconciles member lines; a crosswalk-tracked grant has none.
  const tie = grant.mode === 'membership' ? await tieOut(orgId, id) : null;
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
      />
      <GrantTabs id={id} active="detail" />
      {saved && <Banner tone="ok">Saved.</Banner>}
      {archived && (
        <Banner tone="warn">
          This grant appears in a compute run, so it was archived rather than deleted.
        </Banner>
      )}
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
                ? 'Assigned member lines + effort charges through the report date'
                : 'Crosswalk pieces inside the grant period through the report date'
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
        title="Budget lines"
        action={
          <LinkCell href={`/grants/${id}/bva?asOf=${label}`}>View budget vs actual →</LinkCell>
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
