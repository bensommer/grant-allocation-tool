import Link from 'next/link';
import { StaleRunBanner } from '@/components/stale-run-banner';
import {
  Banner,
  ButtonLink,
  DataTable,
  DateText,
  FilterBar,
  LinkCell,
  Money,
  NumTd,
  PageHeader,
  Period,
  PeriodSubtitle,
  Td,
  Th,
  Toolbar,
  TotalRow,
} from '@/components/ui';
import { GrantPaceStatus } from '@/components/grant-pace-status';
import { getOrgId } from '@/lib/org';
import { currentPeriod } from '@/lib/period';
import { bvaData } from '@/services/bva';

export const dynamic = 'force-dynamic';

export default async function RestrictedPage({
  searchParams,
}: {
  searchParams: Promise<{ asOf?: string; sort?: string; dir?: string }>;
}) {
  const query = await searchParams;
  const orgId = await getOrgId();
  const period = await currentPeriod(orgId, query);
  const { date, label } = period;
  const { run, grants } = await bvaData(orgId, date);
  const rows = grants.filter((g) => g.restrictionType !== 'unrestricted');
  const sum = (pick: (g: (typeof rows)[number]) => number) => rows.reduce((n, g) => n + pick(g), 0);
  const totals = {
    award: sum((g) => g.awardAmountCents),
    received: sum((g) => g.received),
    spent: sum((g) => g.actual),
    balance: sum((g) => g.balance),
    remaining: sum((g) => g.figures.remainingAwardCents),
  };
  const sort = [
    'name',
    'award',
    'received',
    'spent',
    'balance',
    'remaining',
    'pacing',
    'end',
    'days',
  ].includes(query.sort ?? '')
    ? query.sort!
    : 'name';
  const dir = query.dir === 'desc' ? 'desc' : 'asc';
  const days = (end: Date) => Math.ceil((end.getTime() - date.getTime()) / 86_400_000);
  const value = (g: (typeof rows)[number], key: string): string | number =>
    key === 'name'
      ? g.name
      : key === 'award'
        ? g.awardAmountCents
        : key === 'received'
          ? g.received
          : key === 'spent'
            ? g.actual
            : key === 'balance'
              ? g.balance
              : key === 'remaining'
                ? g.figures.remainingAwardCents
                : key === 'pacing'
                  ? g.pace.flag
                  : key === 'end'
                    ? g.endDate.getTime()
                    : days(g.endDate);
  rows.sort((a, b) => {
    const x = value(a, sort),
      y = value(b, sort);
    return (
      (typeof x === 'number' && typeof y === 'number'
        ? x - y
        : String(x).localeCompare(String(y))) * (dir === 'asc' ? 1 : -1)
    );
  });
  const columns: [string, string][] = [
    ['name', 'Grant'],
    ['award', 'Award ($)'],
    ['received', 'Received ($)'],
    ['spent', 'Spent ($)'],
    ['balance', 'Restricted balance ($)'],
    ['remaining', 'Remaining award ($)'],
    ['pacing', 'Pacing'],
    ['end', 'Period'],
    ['days', 'Days remaining'],
  ];
  return (
    <>
      <PageHeader
        title="Restricted funds"
        subtitle={
          <>
            <PeriodSubtitle from={period.range.from} to={date} booksThrough={period.booksThrough} />{' '}
            · Current run: {run ? <DateText date={run.finishedAt ?? run.startedAt} time /> : 'none'}
          </>
        }
        secondaryActions={
          <ButtonLink href="/grants/rollforward" variant="secondary" data-testid="rollforward-link">
            Rollforward →
          </ButtonLink>
        }
      />
      <StaleRunBanner run={run} />
      {!run && (
        <Banner tone="warn">
          No calculation yet — import QuickBooks data or open the{' '}
          <Link href="/activity">activity log</Link>.
        </Banner>
      )}
      <FilterBar>
        <label htmlFor="restricted-as-of">As of</label>
        <input id="restricted-as-of" name="asOf" type="date" defaultValue={label} />
        <input type="hidden" name="sort" value={sort} />
        <input type="hidden" name="dir" value={dir} />
      </FilterBar>
      <Toolbar>
        <ButtonLink variant="secondary" size="sm" href={`/restricted/csv?asOf=${label}`}>
          CSV
        </ButtonLink>
        <ButtonLink variant="secondary" size="sm" href={`/restricted/xlsx?asOf=${label}`}>
          XLSX
        </ButtonLink>
        <ButtonLink variant="secondary" size="sm" href={`/restricted/pdf?asOf=${label}`}>
          PDF
        </ButtonLink>
      </Toolbar>
      <DataTable caption="Restricted grant balances" stickyFirstColumn>
        <thead>
          <tr>
            {columns.map(([key, title]) => (
              <Th
                key={key}
                num={['award', 'received', 'spent', 'balance', 'remaining', 'days'].includes(key)}
              >
                <Link
                  href={`/restricted?asOf=${label}&sort=${key}&dir=${sort === key && dir === 'asc' ? 'desc' : 'asc'}`}
                  prefetch={false}
                >
                  {title}
                </Link>
              </Th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((g) => (
            <tr key={g.id}>
              <Td>
                <LinkCell href={`/grants/${g.id}/bva?asOf=${label}`}>{g.name}</LinkCell>
                <span className="muted block text-sm">{g.funder}</span>
              </Td>
              <NumTd cents={g.awardAmountCents} />
              <NumTd cents={g.received} data-testid="restricted-received" />
              <NumTd cents={g.actual} data-testid="restricted-spent" />
              <NumTd>
                <Money cents={g.balance} data-testid="restricted-balance" />
                {g.balance < 0 && (
                  <span className="muted block text-sm">Spent ahead of receipts</span>
                )}
              </NumTd>
              <NumTd cents={g.figures.remainingAwardCents} data-testid="restricted-remaining" />
              <Td>
                <GrantPaceStatus
                  pace={g.pace}
                  overBudgetLines={g.rows.filter((r) => r.overBudget).map((r) => r.name)}
                />
              </Td>
              <Td>
                <Period from={g.startDate} to={g.endDate} />
              </Td>
              <Td className="num">{days(g.endDate)}</Td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <TotalRow data-testid="restricted-total-row">
            <Th scope="row">Total</Th>
            <NumTd cents={totals.award} dollar data-testid="restricted-total-award" />
            <NumTd cents={totals.received} dollar data-testid="restricted-total-received" />
            <NumTd cents={totals.spent} dollar data-testid="restricted-total-spent" />
            <NumTd cents={totals.balance} dollar data-testid="restricted-total-balance" />
            <NumTd cents={totals.remaining} dollar data-testid="restricted-total-remaining" />
            <Td />
            <Td />
            <Td />
          </TotalRow>
        </tfoot>
      </DataTable>
      <p className="muted mt-4 text-sm">
        Received: matched income transactions in the grant period through as-of. Spent: current-run
        expense allocations to budget lines. Restricted balance = received − spent; remaining award
        = award − spent. Pacing compares spend to straight-line expected award through as-of
        (inclusive days).
      </p>
    </>
  );
}
