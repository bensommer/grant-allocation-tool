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
  Pct,
  Period,
  ProgressBar,
  Td,
  Th,
  TotalRow,
} from '@/components/ui';
import { GrantPaceStatus } from '@/components/grant-pace-status';
import { prisma } from '@/lib/db';
import { getOrgId } from '@/lib/org';
import { bvaData, defaultReportDate } from '@/services/bva';
import { budgetTree } from '@/services/grant-budget';
import { headerMetrics, tieOut } from '@/services/grant-workspace';
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
  const tree = await budgetTree(orgId, id);
  const [metrics, tie] = await Promise.all([
    headerMetrics(orgId, grant, date),
    tieOut(orgId, id, tree),
  ]);
  const programNames = new Map(programs.map((p) => [p.id, p.name]));
  const receipts = await prisma.transactionLine.findMany({
    where: {
      orgId,
      deletedAt: null,
      account: { type: { in: ['Income', 'OtherIncome'] } },
      transaction: {
        orgId,
        deletedAt: null,
        txnDate: { gte: grant.startDate, lte: date < grant.endDate ? date : grant.endDate },
      },
    },
    select: {
      id: true,
      amountCents: true,
      accountId: true,
      classId: true,
      partyId: true,
      account: { select: { type: true } },
      transaction: { select: { txnDate: true, partyId: true } },
    },
  });
  const { matchesReceived } = await import('@/domain/received');
  const matched = receipts.filter((r) =>
    matchesReceived(grant, {
      accountId: r.accountId,
      accountType: r.account.type,
      classId: r.classId,
      transactionPartyId: r.transaction.partyId,
      linePartyId: r.partyId,
    }),
  );
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
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4" data-testid="header-metrics">
        <Card>
          <KeyFigure label="Award" value={<Money cents={metrics.awardCents} dollar data-testid="metric-award" />} />
        </Card>
        <Card>
          <KeyFigure
            label="Received"
            value={<Money cents={metrics.receivedCents} dollar data-testid="metric-received" />}
            hint="Grant income lines through the report date"
          />
        </Card>
        <Card>
          <KeyFigure
            label="Spent"
            value={<Money cents={metrics.spentCents} dollar data-testid="metric-spent" />}
            hint="Assigned lines + effort charges, current run"
          />
        </Card>
        <Card>
          <KeyFigure
            label="Restricted balance"
            value={<Money cents={metrics.restrictedBalanceCents} dollar data-testid="metric-balance" />}
            hint="Received − spent"
          />
        </Card>
        <Card>
          <KeyFigure
            label="Time elapsed vs. spent"
            value={
              <span data-testid="elapsed-vs-spent">
                <Pct basisPoints={metrics.elapsedBps} /> · <Pct basisPoints={metrics.spentBps} />
              </span>
            }
            hint="% of the grant period elapsed · % of the award spent"
          />
        </Card>
        <Card>
          <KeyFigure
            label="Projected at grant end"
            value={
              metrics.projectedAtEndCents === null ? (
                <span className="muted">—</span>
              ) : (
                <Money cents={metrics.projectedAtEndCents} dollar />
              )
            }
            hint="Straight line from the spend rate to date"
          />
        </Card>
        <Card>
          <KeyFigure
            label="Remaining award"
            value={<Money cents={metrics.awardCents - metrics.spentCents} dollar />}
          />
        </Card>
        <Card>
          <KeyFigure
            label="Pacing"
            value={
              <GrantPaceStatus
                pace={grant.pace}
                overBudgetLines={grant.rows.filter((r) => r.overBudget).map((r) => r.name)}
              />
            }
            hint={
              <>
                As of <DateText date={date} />
              </>
            }
          />
        </Card>
      </div>
      <Card title="Tie-out">
        <TieOutPanel id={id} tieOut={tie} />
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
                    <DateText date={r.transaction.txnDate} />
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
