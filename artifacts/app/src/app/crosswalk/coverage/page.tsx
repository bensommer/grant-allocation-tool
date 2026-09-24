import Link from 'next/link';
import { PageHeader } from '@/components/page-header';
import { formatCents, formatPct1 } from '@/domain/money';
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
  return (
    <>
      <PageHeader
        title="Crosswalk coverage"
        actions={
          <Link href="/crosswalk" className="btn btn-secondary btn-sm">
            All rules
          </Link>
        }
      />
      <form method="get" className="mb-3 flex items-end gap-2">
        <label>
          From <input type="date" name="from" defaultValue={range.from} />
        </label>
        <label>
          To <input type="date" name="to" defaultValue={range.to} />
        </label>
        <button className="btn btn-secondary">Filter</button>
      </form>
      {range.error ? <div className="banner banner-bad">{range.error}</div> : null}
      {!data.run ? (
        <div className="banner banner-warn">
          No current run — recompute on <Link href="/runs">/runs</Link>.
        </div>
      ) : (
        <>
          <div className="card">
            <table>
              <thead>
                <tr>
                  <th>Program</th>
                  <th className="num">Total expense</th>
                  <th className="num">Mapped</th>
                  <th className="num">Unmapped</th>
                  <th className="num">Conflict</th>
                  <th className="num">% mapped</th>
                </tr>
              </thead>
              <tbody>
                {programs.map((p) => {
                  const pieces = expenses.filter((x) => x.programId === p.id);
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
                        {p.code} {p.name}
                      </td>
                      <td className="num">{formatCents(total)}</td>
                      <td className="num">{formatCents(mapped)}</td>
                      <td className="num">{formatCents(total - mapped - conflict)}</td>
                      <td className="num">{formatCents(conflict)}</td>
                      <td className="num">{formatPct1(mapped, total)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className="card mt-4">
            <h2>Unmapped detail</h2>
            {programs.map((p) => {
              const rows = expenses.filter(
                (x) =>
                  x.programId === p.id && !x.grantBudgetLineId && x.status !== 'crosswalk_conflict',
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
                    {p.code} — {p.name}
                  </h3>
                  <table>
                    <thead>
                      <tr>
                        <th>Account</th>
                        <th className="num">Amount</th>
                        <th className="num">Pieces</th>
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
                                {a.number} {a.name}
                              </Link>
                            </td>
                            <td className="num">
                              {formatCents(subset.reduce((n, x) => n + x.amountCents, 0))}
                            </td>
                            <td className="num">{subset.length}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </section>
              );
            })}
          </div>
        </>
      )}
    </>
  );
}
