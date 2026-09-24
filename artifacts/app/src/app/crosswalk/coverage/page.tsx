import Link from 'next/link';
import {
  Banner,
  ButtonLink,
  DataTable,
  FilterBar,
  Money,
  NumTd,
  PageHeader,
  Th,
} from '@/components/ui';
import { formatPct1 } from '@/domain/money';
import { prisma } from '@/lib/db';
import { getOrgId } from '@/lib/org';
import { currentPieces } from '../pieces';
import { dateRange } from '../range';

export const dynamic = 'force-dynamic';

export default async function CoveragePage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; to?: string }>;
}) {
  const { from, to } = await searchParams;
  const range = dateRange(from, to);
  const orgId = await getOrgId();
  const [programs, data] = await Promise.all([
    prisma.program.findMany({ where: { orgId, active: true }, orderBy: { code: 'asc' } }),
    currentPieces(orgId, range.first ?? undefined, range.last ?? undefined),
  ]);
  const expenses = data.pieces.filter((p) =>
    ['Expense', 'COGS', 'OtherExpense'].includes(p.sourceLine.account.type),
  );
  const byProgram = new Map<string, typeof expenses>();
  for (const x of expenses) {
    const arr = byProgram.get(x.programId ?? '');
    if (arr) arr.push(x);
    else byProgram.set(x.programId ?? '', [x]);
  }
  return (
    <>
      <PageHeader
        title="Crosswalk coverage"
        secondaryActions={
          <ButtonLink href="/crosswalk" variant="secondary">
            All rules
          </ButtonLink>
        }
      />
      <FilterBar action="/crosswalk/coverage">
        <label>
          From <input type="date" name="from" defaultValue={range.from} />
        </label>
        <label>
          To <input type="date" name="to" defaultValue={range.to} />
        </label>
      </FilterBar>
      {range.error ? <Banner tone="bad">{range.error}</Banner> : null}
      {!data.run ? (
        <Banner tone="warn">
          No current run — recompute on <Link href="/runs">/runs</Link>.
        </Banner>
      ) : (
        <>
          <div className="card">
            <DataTable caption="Crosswalk coverage">
              <thead>
                <tr>
                  <Th>Program</Th>
                  <Th num>Total expense ($)</Th>
                  <Th num>Mapped ($)</Th>
                  <Th num>Unmapped ($)</Th>
                  <Th num>Conflict ($)</Th>
                  <Th num>% mapped</Th>
                </tr>
              </thead>
              <tbody>
                {programs.map((p) => {
                  const pieces = byProgram.get(p.id) ?? [];
                  const sum = (items: typeof pieces) =>
                    items.reduce((n, x) => n + x.amountCents, 0);
                  const total = sum(pieces);
                  const mapped = sum(
                    pieces.filter((x) => x.grantBudgetLineId && x.status !== 'crosswalk_conflict'),
                  );
                  const conflict = sum(pieces.filter((x) => x.status === 'crosswalk_conflict'));
                  return (
                    <tr key={p.id}>
                      <td>
                        {p.name}
                        <span className="muted block text-xs">{p.code}</span>
                      </td>
                      <NumTd cents={total} />
                      <NumTd cents={mapped} />
                      <NumTd cents={total - mapped - conflict} />
                      <NumTd cents={conflict} />
                      <td className="num">{formatPct1(mapped, total)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </DataTable>
          </div>
          <div className="card mt-4">
            <h2>Unmapped detail</h2>
            {programs.map((p) => {
              const rows = (byProgram.get(p.id) ?? []).filter(
                (x) => !x.grantBudgetLineId && x.status !== 'crosswalk_conflict',
              );
              if (!rows.length) return null;
              const accounts = [
                ...new Map(
                  rows.map((x) => [x.sourceLine.accountId, x.sourceLine.account]),
                ).values(),
              ];
              return (
                <section key={p.id}>
                  <h3>
                    {p.name}
                    <span className="muted ml-2 text-xs">{p.code}</span>
                  </h3>
                  <DataTable caption={`Unmapped expense for ${p.name}`}>
                    <thead>
                      <tr>
                        <Th>Account</Th>
                        <Th num>Amount ($)</Th>
                        <Th num>Pieces</Th>
                      </tr>
                    </thead>
                    <tbody>
                      {accounts.map((a) => {
                        const subset = rows.filter((x) => x.sourceLine.accountId === a.id);
                        const query = new URLSearchParams({
                          accountId: a.id,
                          programId: p.id,
                          from: range.from,
                          to: range.to,
                        });
                        return (
                          <tr key={a.id}>
                            <td>
                              <Link href={`/crosswalk/lines?${query}`}>
                                {a.name}
                                <span className="muted block text-xs">{a.number}</span>
                              </Link>
                            </td>
                            <NumTd cents={subset.reduce((n, x) => n + x.amountCents, 0)} />
                            <td className="num">{subset.length}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </DataTable>
                </section>
              );
            })}
          </div>
        </>
      )}
    </>
  );
}
