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
  Td,
  Th,
  Toolbar,
} from '@/components/ui';
import { GrantPaceStatus } from '@/components/grant-pace-status';
import { getOrgId } from '@/lib/org';
import { bvaData, defaultReportDate } from '@/services/bva';

export const dynamic = 'force-dynamic';

export default async function RestrictedPage({
  searchParams,
}: {
  searchParams: Promise<{ asOf?: string; sort?: string; dir?: string }>;
}) {
  const query = await searchParams;
  const orgId = await getOrgId();
  const { date, label } = await defaultReportDate(orgId, query.asOf);
  const { run, grants } = await bvaData(orgId, date);
  const rows = grants.filter((g) => g.restrictionType !== 'unrestricted');
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
                ? g.awardAmountCents - g.actual
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
            As of <DateText date={date} /> · Current run:{' '}
            {run ? <DateText date={run.finishedAt ?? run.startedAt} time /> : 'none'}
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
          No current run — recompute on <Link href="/runs">Compute runs</Link>.
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
              <NumTd cents={g.received} />
              <NumTd cents={g.actual} />
              <NumTd>
                <Money cents={g.balance} />
                {g.balance < 0 && (
                  <span className="muted block text-sm">Spent ahead of receipts</span>
                )}
              </NumTd>
              <NumTd cents={g.awardAmountCents - g.actual} />
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
      </DataTable>
      <p className="muted mt-4 text-sm">
        Received: matched income source lines in the grant period through as-of. Spent: current-run
        expense allocations to budget lines. Restricted balance = received − spent; remaining award
        = award − spent. Pacing compares spend to straight-line expected award through as-of
        (inclusive days).
      </p>
    </>
  );
}
