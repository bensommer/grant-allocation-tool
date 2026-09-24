import Link from 'next/link';
import {
  Banner,
  Card,
  DateText,
  FilterBar,
  KeyFigure,
  MiniBarChart,
  Money,
  Month,
  PageHeader,
  StatusPill,
} from '@/components/ui';
import { GrantPaceStatus } from '@/components/grant-pace-status';
import { formatDate, formatMonth, type YearMonth } from '@/domain/format';
import { prisma } from '@/lib/db';
import { getOrgId } from '@/lib/org';
import { bvaData, defaultReportDate } from '@/services/bva';

export const dynamic = 'force-dynamic';

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ asOf?: string }>;
}) {
  const orgId = await getOrgId();
  const { label, date, coverage } = await defaultReportDate(orgId, (await searchParams).asOf);
  const [{ run, grants }, lastImport] = await Promise.all([
    bvaData(orgId, date),
    prisma.importBatch.findFirst({ where: { orgId }, orderBy: { startedAt: 'desc' } }),
  ]);
  const flagged = grants.filter((g) => g.flagged);
  const restricted = grants.filter((g) => g.restrictionType !== 'unrestricted');
  const checks = (run?.checks ?? []) as unknown as {
    name: string;
    status?: string;
    ok: boolean;
    href?: string;
    detail?: string;
  }[];
  const latestCounts = lastImport?.counts as { lockIds?: string[] } | undefined;
  const expenses = run
    ? await prisma.allocatedLine.findMany({
        where: {
          orgId,
          computeRunId: run.id,
          status: 'ok',
          sourceLine: {
            account: { type: { in: ['Expense', 'COGS', 'OtherExpense'] } },
            transaction: { orgId, deletedAt: null, txnDate: { lte: date } },
          },
        },
        select: {
          amountCents: true,
          programId: true,
          grantBudgetLineId: true,
          program: { select: { name: true, code: true, functionalCategory: true } },
          sourceLine: { select: { transaction: { select: { txnDate: true } } } },
        },
      })
    : [];
  const unmapped = expenses.filter(
    (p) => p.program?.functionalCategory === 'program' && p.grantBudgetLineId === null,
  );
  const nonGrant = expenses.filter(
    (p) => p.program?.functionalCategory !== 'program' && p.program !== null,
  );
  const group = (items: typeof expenses) => {
    const totals = new Map<string, { name: string; code: string; cents: number }>();
    for (const item of items) {
      if (!item.programId || !item.program) continue;
      const previous = totals.get(item.programId);
      totals.set(item.programId, {
        name: item.program.name,
        code: item.program.code,
        cents: (previous?.cents ?? 0) + item.amountCents,
      });
    }
    return [...totals.values()];
  };
  const monthly = new Map<string, number>();
  for (const item of expenses) {
    const month = item.sourceLine.transaction.txnDate.toISOString().slice(0, 7);
    monthly.set(month, (monthly.get(month) ?? 0) + item.amountCents);
  }
  const months = [...monthly.keys()].sort() as YearMonth[];
  const points = months.map((ym) => ({
    label: formatMonthLabel(ym, months),
    cents: monthly.get(ym)!,
  }));
  return (
    <>
      <PageHeader
        title="Dashboard"
        subtitle={
          <>
            As of <DateText date={date} /> · Current run:{' '}
            <span data-volatile>
              {run ? <DateText date={run.finishedAt ?? run.startedAt} time /> : 'none'}
            </span>
          </>
        }
      />
      {coverage && date > coverage && (
        <Banner tone="warn">
          As of {formatDate(date)} is after the last imported transaction ({formatDate(coverage)});
          pacing will look under pace until newer books are imported.
        </Banner>
      )}
      {run?.stale && (
        <Banner tone="warn">
          Configuration changed since the current run. Reports show numbers from{' '}
          <DateText date={run.finishedAt ?? run.startedAt} time /> until you recompute.
        </Banner>
      )}
      {!run && (
        <Banner tone="warn">
          No current run — recompute on <Link href="/runs">Compute runs</Link>.
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
      <div className="grid gap-4 md:grid-cols-2">
        <Card
          title="Restricted balances"
          action={<Link href={`/restricted?asOf=${label}`}>View funds →</Link>}
        >
          <KeyFigure
            label="Received minus spent"
            value={<Money cents={restricted.reduce((n, g) => n + g.balance, 0)} dollar />}
            hint="A negative balance means spending is ahead of receipts."
          />
        </Card>
        <Card title="Flagged grants" action={<Link href="/grants">View grants →</Link>}>
          <KeyFigure label="Grants requiring attention" value={flagged.length} />
          <ul className="mt-3 space-y-2">
            {flagged.map((g) => (
              <li key={g.id}>
                <Link href={`/grants/${g.id}/bva?asOf=${label}`}>{g.name}</Link>{' '}
                <GrantPaceStatus
                  pace={g.pace}
                  overBudgetLines={g.rows.filter((r) => r.overBudget).map((r) => r.name)}
                />
              </li>
            ))}
          </ul>
        </Card>
        <Card
          title="Unmapped program expense"
          action={<Link href="/crosswalk/coverage">View coverage →</Link>}
        >
          <KeyFigure
            label="Program-service expense without a grant budget line"
            value={<Money cents={unmapped.reduce((n, p) => n + p.amountCents, 0)} dollar />}
          />
          <ul className="mt-3">
            {group(unmapped).map((row) => (
              <li key={row.code}>
                {row.name} <span className="muted text-sm">{row.code}</span>:{' '}
                <Money cents={row.cents} dollar />
              </li>
            ))}
          </ul>
        </Card>
        <Card title="Non-grant expense">
          <KeyFigure
            label="M&G and Fundraising · expected, not a warning"
            value={<Money cents={nonGrant.reduce((n, p) => n + p.amountCents, 0)} dollar />}
          />
          <ul className="mt-3">
            {group(nonGrant).map((row) => (
              <li key={row.code}>
                {row.name} <span className="muted text-sm">{row.code}</span>:{' '}
                <Money cents={row.cents} dollar />
              </li>
            ))}
          </ul>
        </Card>
        <Card title="Activity" action={<Link href="/runs">Compute runs →</Link>}>
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
            Last compute:{' '}
            {run ? (
              <>
                <DateText date={run.finishedAt ?? run.startedAt} time />
                {run.stale ? ' · stale' : ''}
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
      <Card
        title="Reconciliation checks"
        action={<Link href={run ? `/runs/${run.id}` : '/runs'}>View run →</Link>}
      >
        {!run ? (
          <p className="muted">Recompute to run checks.</p>
        ) : (
          <ul className="space-y-2">
            {checks
              .filter((c) => c.name !== 'stats')
              .map((c) => (
                <li key={c.name}>
                  <StatusPill tone={c.status === 'warn' ? 'warn' : c.ok ? 'ok' : 'bad'}>
                    {c.status ?? (c.ok ? 'pass' : 'fail')}
                  </StatusPill>{' '}
                  <Link href={c.href ?? `/runs/${run.id}`}>{c.name.replaceAll('_', ' ')}</Link>
                  {c.detail ? ` · ${c.detail}` : ''}
                </li>
              ))}
          </ul>
        )}
      </Card>
      <p className="muted mt-4 text-sm">
        Flagged means spending is outside configured straight-line pacing thresholds or a budget
        line is over budget. Totals use current-run expense allocations; income receipts are read
        from matching source lines.
      </p>
    </>
  );
}

function formatMonthLabel(ym: YearMonth, context: YearMonth[]) {
  return formatMonth(ym, {}, context);
}
