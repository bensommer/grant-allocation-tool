import Link from 'next/link';
import {
  Banner,
  ButtonLink,
  DataTable,
  FilterBar,
  Legend,
  Money,
  PageHeader,
  StatusPill,
  Th,
} from '@/components/ui';
import { toISODate } from '@/domain/dates';
import { prisma } from '@/lib/db';
import { getOrgId } from '@/lib/org';
import { currentPieces } from '../pieces';
import { dateRange } from '../range';

export const dynamic = 'force-dynamic';

export default async function MatrixPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; to?: string }>;
}) {
  const { from, to } = await searchParams;
  const orgId = await getOrgId();
  const latest = await prisma.transaction.findFirst({
    where: { orgId, deletedAt: null },
    orderBy: { txnDate: 'desc' },
    select: { txnDate: true },
  });
  const date = latest?.txnDate ?? new Date();
  const year = date.getUTCFullYear();
  const quarter = Math.floor(date.getUTCMonth() / 3);
  const range = dateRange(
    from ?? toISODate(new Date(Date.UTC(year, quarter * 3, 1))),
    to ?? toISODate(new Date(Date.UTC(year, quarter * 3 + 3, 0))),
  );
  const [accounts, programs, data] = await Promise.all([
    prisma.account.findMany({
      where: { orgId, type: { in: ['Expense', 'COGS', 'OtherExpense'] }, deletedAt: null },
      orderBy: { number: 'asc' },
    }),
    prisma.program.findMany({ where: { orgId, active: true }, orderBy: { name: 'asc' } }),
    currentPieces(orgId, range.first ?? undefined, range.last ?? undefined),
  ]);
  programs.sort(
    (a, b) =>
      (a.functionalCategory === 'program' ? 0 : 1) - (b.functionalCategory === 'program' ? 0 : 1) ||
      a.name.localeCompare(b.name),
  );
  const byCell = new Map<string, typeof data.pieces>();
  for (const x of data.pieces) {
    const key = `${x.sourceLine.accountId}|${x.programId}`;
    const arr = byCell.get(key);
    if (arr) arr.push(x);
    else byCell.set(key, [x]);
  }
  return (
    <>
      <PageHeader
        title="Crosswalk matrix"
        secondaryActions={
          <ButtonLink href="/crosswalk" variant="secondary">
            All rules
          </ButtonLink>
        }
      />
      {range.error ? <Banner tone="bad">{range.error}</Banner> : null}
      <FilterBar action="/crosswalk/matrix">
        <label>
          From <input type="date" name="from" defaultValue={range.from} />
        </label>
        <label>
          To <input type="date" name="to" defaultValue={range.to} />
        </label>
      </FilterBar>
      <Legend
        items={[
          { tone: 'ok', label: 'Mapped' },
          { tone: 'warn', label: 'Unmapped' },
          { tone: 'bad', label: 'Conflict' },
          { tone: 'muted', label: 'No expense / support function' },
        ]}
      />
      {!data.run ? (
        <Banner tone="warn">
          No current run — recompute on <Link href="/runs">Runs</Link>.
        </Banner>
      ) : (
        <DataTable caption="Expense by account and program" stickyFirstColumn>
          <thead>
            <tr>
              <Th>Expense account</Th>
              {programs.map((p) => (
                <Th
                  key={p.id}
                  className={p.functionalCategory !== 'program' ? 'bg-slate-50 text-slate-600' : ''}
                >
                  {p.name}
                  <span className="muted block text-xs">{p.code}</span>
                </Th>
              ))}
            </tr>
          </thead>
          <tbody>
            {accounts.map((a) => (
              <tr key={a.id}>
                <Th scope="row">
                  {a.name}
                  <span className="muted block text-xs">{a.number}</span>
                </Th>
                {programs.map((p) => {
                  const cell = byCell.get(`${a.id}|${p.id}`) ?? [];
                  const support = p.functionalCategory !== 'program';
                  const conflict = cell.some((x) => x.status === 'crosswalk_conflict');
                  const unmapped =
                    !support &&
                    cell.some((x) => !x.grantBudgetLineId && x.status !== 'crosswalk_conflict');
                  const lines = [
                    ...new Map(
                      cell
                        .filter((x) => x.grantBudgetLine)
                        .map((x) => [x.grantBudgetLineId, x.grantBudgetLine!]),
                    ).values(),
                  ];
                  const status = conflict
                    ? 'Conflict'
                    : unmapped
                      ? 'Unmapped'
                      : !cell.length
                        ? 'No expense'
                        : support
                          ? 'Support function'
                          : 'Mapped';
                  const tone = conflict
                    ? 'bad'
                    : unmapped
                      ? 'warn'
                      : !cell.length || support
                        ? 'muted'
                        : 'ok';
                  const query = new URLSearchParams({
                    accountId: a.id,
                    programId: p.id,
                    from: range.from,
                    to: range.to,
                  });
                  return (
                    <td key={p.id} className={support ? 'bg-slate-50' : ''}>
                      <Link
                        href={`/crosswalk/lines?${query}`}
                        className="block min-w-40 rounded p-2 hover:underline"
                      >
                        <Money cents={cell.reduce((sum, x) => sum + x.amountCents, 0)} dollar />
                        <span className="mt-1 block">
                          <StatusPill tone={tone}>{status}</StatusPill>
                        </span>
                        {lines.map((line) => (
                          <span className="mt-1 block text-sm" key={line.id}>
                            {line.name}
                            <span className="muted block text-xs">{line.grant.name}</span>
                          </span>
                        ))}
                      </Link>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </DataTable>
      )}
    </>
  );
}
