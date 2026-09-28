import Link from 'next/link';
import {
  Banner,
  ButtonLink,
  DataTable,
  FilterBar,
  Money,
  NumTd,
  PageHeader,
  PeriodSubtitle,
  Th,
  TotalRow,
} from '@/components/ui';
import { formatPct1 } from '@/domain/money';
import { prisma } from '@/lib/db';
import { getOrgId } from '@/lib/org';
import { currentRange } from '@/lib/period';
import { isExpenseAccountType, unmappedProgramExpense } from '@/domain/unmapped';
import { currentPieces } from '../pieces';

export const dynamic = 'force-dynamic';

export default async function CoveragePage({
  searchParams,
}: {
  searchParams: Promise<{ asOf?: string; from?: string; to?: string }>;
}) {
  const orgId = await getOrgId();
  const range = await currentRange(orgId, await searchParams);
  const [programs, data] = await Promise.all([
    prisma.program.findMany({ where: { orgId, active: true }, orderBy: { code: 'asc' } }),
    currentPieces(orgId, range.error ? undefined : range.from, range.error ? undefined : range.to),
  ]);
  const period = range.error ? null : { from: range.from, to: range.to };
  const expenses = data.pieces.filter((p) => isExpenseAccountType(p.sourceLine.account.type));
  const byProgram = new Map<string, typeof expenses>();
  for (const x of expenses) {
    const arr = byProgram.get(x.programId ?? '');
    if (arr) arr.push(x);
    else byProgram.set(x.programId ?? '', [x]);
  }
  const sum = (items: typeof expenses) => items.reduce((n, x) => n + x.amountCents, 0);
  // One definition of "unmapped" (JPH-25 A3, src/domain/unmapped.ts): status ok, program-
  // category program, no budget line, inside the period. A conflict of either kind is a
  // conflict, never a gap, so total = mapped + unmapped + conflict on every row.
  const figures = programs.map((p) => {
    const pieces = byProgram.get(p.id) ?? [];
    const total = sum(pieces);
    const conflict = sum(pieces.filter((x) => x.status !== 'ok'));
    const mapped = sum(pieces.filter((x) => x.status === 'ok' && x.grantBudgetLineId));
    const nonGrant = p.functionalCategory !== 'program';
    const unmapped = nonGrant ? 0 : unmappedProgramExpense(pieces, period).cents;
    return { program: p, total, mapped, conflict, unmapped, nonGrant };
  });
  const totals = (rows: typeof figures) => ({
    total: rows.reduce((n, r) => n + r.total, 0),
    mapped: rows.reduce((n, r) => n + r.mapped, 0),
    unmapped: rows.reduce((n, r) => n + r.unmapped, 0),
    conflict: rows.reduce((n, r) => n + r.conflict, 0),
  });
  const programTotals = totals(figures.filter((r) => !r.nonGrant));
  const nonGrantTotals = totals(figures.filter((r) => r.nonGrant));
  return (
    <>
      <PageHeader
        title="Crosswalk coverage"
        subtitle={
          <PeriodSubtitle
            from={range.from}
            to={range.to}
            booksThrough={range.period.booksThrough}
          />
        }
        secondaryActions={
          <ButtonLink href="/crosswalk" variant="secondary">
            All rules
          </ButtonLink>
        }
      />
      <FilterBar action="/crosswalk/coverage">
        <label>
          From <input type="date" name="from" defaultValue={range.fromLabel} />
        </label>
        <label>
          To <input type="date" name="to" defaultValue={range.toLabel} />
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
                {figures.map(({ program: p, total, mapped, unmapped, conflict, nonGrant }) => (
                  <tr
                    key={p.id}
                    data-testid="coverage-row"
                    data-program={p.code}
                    data-non-grant={nonGrant ? 'true' : undefined}
                    className={nonGrant ? 'text-slate-500' : undefined}
                  >
                    <td>
                      {p.name}
                      <span className="muted block text-xs">{p.code}</span>
                    </td>
                    <NumTd cents={total} data-testid="coverage-row-expense" />
                    <NumTd cents={mapped} data-testid="coverage-row-mapped" />
                    <NumTd cents={unmapped} data-testid="coverage-row-unmapped" />
                    <NumTd cents={conflict} data-testid="coverage-row-conflict" />
                    <td className="num muted" data-testid="coverage-row-pct">
                      {nonGrant ? 'n/a — non-grant' : formatPct1(mapped, total)}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <TotalRow data-testid="coverage-total-row">
                  <Th scope="row">Total — program rows</Th>
                  <NumTd cents={programTotals.total} dollar data-testid="coverage-total-expense" />
                  <NumTd cents={programTotals.mapped} dollar data-testid="coverage-total-mapped" />
                  <NumTd
                    cents={programTotals.unmapped}
                    dollar
                    zero="zero"
                    data-testid="coverage-total-unmapped"
                  />
                  <NumTd
                    cents={programTotals.conflict}
                    dollar
                    data-testid="coverage-total-conflict"
                  />
                  <td className="num" data-testid="coverage-total-pct">
                    {formatPct1(programTotals.mapped, programTotals.total)}
                  </td>
                </TotalRow>
                <tr className="text-slate-500" data-testid="coverage-non-grant-row">
                  <Th scope="row" className="font-normal">
                    Non-grant (management & general, fundraising)
                  </Th>
                  <NumTd
                    cents={nonGrantTotals.total}
                    dollar
                    data-testid="coverage-non-grant-expense"
                  />
                  <NumTd cents={nonGrantTotals.mapped} dollar />
                  <td className="num">—</td>
                  <NumTd cents={nonGrantTotals.conflict} dollar />
                  <td className="num">n/a — non-grant</td>
                </tr>
              </tfoot>
            </DataTable>
          </div>
          <div className="card mt-4">
            <h2>Unmapped detail</h2>
            <p className="muted mb-3 text-sm">
              Program expense with no crosswalk rule yet. Create a rule from the row, or open the
              transactions behind it.
            </p>
            {figures.map(({ program: p, nonGrant }) => {
              if (nonGrant) return null;
              const rows = unmappedProgramExpense(byProgram.get(p.id) ?? [], period).pieces;
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
                        <Th num>Transactions</Th>
                        <Th aria-label="Actions" />
                      </tr>
                    </thead>
                    <tbody>
                      {accounts.map((a) => {
                        const subset = rows.filter((x) => x.sourceLine.accountId === a.id);
                        const query = new URLSearchParams({
                          accountId: a.id,
                          programId: p.id,
                          from: range.fromLabel,
                          to: range.toLabel,
                        });
                        const transactions = new Set(subset.map((x) => x.sourceLine.transactionId))
                          .size;
                        const create = new URLSearchParams({ programId: p.id, accountId: a.id });
                        return (
                          <tr
                            key={a.id}
                            data-testid="unmapped-account"
                            data-program={p.code}
                            data-account={a.number ?? ''}
                          >
                            <td>
                              <Link href={`/crosswalk/lines?${query}`}>
                                {a.name}
                                <span className="muted block text-xs">{a.number}</span>
                              </Link>
                            </td>
                            <NumTd
                              cents={subset.reduce((n, x) => n + x.amountCents, 0)}
                              data-testid="unmapped-amount"
                            />
                            <td className="num" data-testid="unmapped-transactions">
                              {transactions}
                            </td>
                            <td className="num">
                              <ButtonLink
                                href={`/crosswalk/new?${create}`}
                                variant="secondary"
                                size="sm"
                                data-testid="create-rule"
                              >
                                Create rule
                              </ButtonLink>
                            </td>
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
