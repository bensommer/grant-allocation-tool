import {
  Banner,
  ButtonLink,
  DataTable,
  EmptyState,
  FilterBar,
  LinkCell,
  Money,
  NumTd,
  PageHeader,
  Period,
  ProgressBar,
  Td,
  Th,
} from '@/components/ui';
import { GrantPaceStatus } from '@/components/grant-pace-status';
import { getOrgId } from '@/lib/org';
import { bvaData, defaultReportDate } from '@/services/bva';
import { GRANT_STATUS_LABEL, type GrantStatusKey } from './labels';

export const dynamic = 'force-dynamic';
const STATUSES = Object.keys(GRANT_STATUS_LABEL) as GrantStatusKey[];

export default async function GrantsPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; deleted?: string; asOf?: string }>;
}) {
  const { status, deleted, asOf } = await searchParams;
  const orgId = await getOrgId();
  const { date } = await defaultReportDate(orgId, asOf);
  const { grants } = await bvaData(orgId, date);
  const filter = STATUSES.includes(status as GrantStatusKey)
    ? (status as GrantStatusKey)
    : undefined;
  const rows = grants.filter((g) => !filter || g.status === filter);
  return (
    <>
      <PageHeader
        title="Grants"
        subtitle="Awards, spending and pacing from the current compute run."
        primaryAction={<ButtonLink href="/grants/new">New grant</ButtonLink>}
      />
      {deleted && <Banner tone="ok">Grant deleted.</Banner>}
      <FilterBar action="/grants">
        <label htmlFor="status">Status</label>
        <select id="status" name="status" defaultValue={filter ?? ''}>
          <option value="">All</option>
          {STATUSES.map((s) => (
            <option key={s} value={s}>
              {GRANT_STATUS_LABEL[s]}
            </option>
          ))}
        </select>
        <input type="hidden" name="asOf" value={date.toISOString().slice(0, 10)} />
      </FilterBar>
      {rows.length === 0 ? (
        <EmptyState
          title="No grants"
          hint={
            filter
              ? `No grants with status ${GRANT_STATUS_LABEL[filter]}.`
              : 'Create a grant to get started.'
          }
        />
      ) : (
        <DataTable caption="Grant awards and spending" stickyFirstColumn>
          <thead>
            <tr>
              <Th>Grant</Th>
              <Th>Period</Th>
              <Th num>Award ($)</Th>
              <Th num>Spent ($)</Th>
              <Th num>Restricted balance ($)</Th>
              <Th>Pacing</Th>
            </tr>
          </thead>
          <tbody>
            {rows.map((g) => (
              <tr key={g.id}>
                <Td>
                  <LinkCell href={`/grants/${g.id}`}>{g.name}</LinkCell>
                  <span className="muted block text-sm">{g.funder}</span>
                </Td>
                <Td>
                  <Period from={g.startDate} to={g.endDate} />
                </Td>
                <NumTd cents={g.awardAmountCents} />
                <NumTd>
                  <Money cents={g.actual} />
                  <ProgressBar
                    used={g.actual}
                    budget={g.awardAmountCents}
                    label={`${g.name} award used`}
                  />
                </NumTd>
                <NumTd cents={g.balance} />
                <Td>
                  <GrantPaceStatus
                    pace={g.pace}
                    overBudgetLines={g.rows.filter((r) => r.overBudget).map((r) => r.name)}
                  />
                </Td>
              </tr>
            ))}
          </tbody>
        </DataTable>
      )}
    </>
  );
}
