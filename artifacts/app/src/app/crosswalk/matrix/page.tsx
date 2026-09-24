import Link from 'next/link';
import { PageHeader } from '@/components/page-header';
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
  const range = from || to ? dateRange(from, to) : null;
  const [accounts, programs, data] = await Promise.all([
    prisma.account.findMany({
      where: { orgId, type: { in: ['Expense', 'COGS', 'OtherExpense'] }, deletedAt: null },
      orderBy: { number: 'asc' },
    }),
    prisma.program.findMany({ where: { orgId, active: true }, orderBy: { code: 'asc' } }),
    currentPieces(orgId, range?.first ?? undefined, range?.last ?? undefined),
  ]);
  return (
    <>
      <PageHeader
        title="Crosswalk matrix"
        actions={
          <Link href="/crosswalk" className="btn btn-secondary btn-sm">
            All rules
          </Link>
        }
      />
      {range?.error ? <div className="banner banner-bad">{range.error}</div> : null}
      <form method="get" className="mb-3 flex items-end gap-2">
        <label>
          From <input type="date" name="from" defaultValue={from ?? ''} />
        </label>
        <label>
          To <input type="date" name="to" defaultValue={to ?? ''} />
        </label>
        <button className="btn btn-secondary">Filter</button>
      </form>
      {!data.run ? (
        <div className="banner banner-warn">
          No current run — recompute on <Link href="/runs">/runs</Link>.
        </div>
      ) : (
        <div className="card overflow-x-auto">
          <table>
            <thead>
              <tr>
                <th>Expense account</th>
                {programs.map((p) => (
                  <th key={p.id}>{p.code}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {accounts.map((a) => (
                <tr key={a.id}>
                  <th>
                    {a.number} {a.name}
                  </th>
                  {programs.map((p) => {
                    const cell = data.pieces.filter(
                      (x) => x.sourceLine.accountId === a.id && x.programId === p.id,
                    );
                    const conflict = cell.some((x) => x.status === 'crosswalk_conflict');
                    const lines = [
                      ...new Set(
                        cell
                          .filter((x) => x.grantBudgetLine)
                          .map(
                            (x) =>
                              `${x.grantBudgetLine!.grant.awardNumber ?? x.grantBudgetLine!.grant.name}/${x.grantBudgetLine!.code}`,
                          ),
                      ),
                    ];
                    const unmapped = cell.some(
                      (x) => !x.grantBudgetLineId && x.status !== 'crosswalk_conflict',
                    );
                    const label = conflict
                      ? 'conflict'
                      : unmapped
                        ? 'unmapped'
                        : lines.join(', ') || '—';
                    const style = conflict
                      ? 'pill-bad'
                      : unmapped
                        ? 'pill-warn'
                        : cell.length
                          ? 'pill-ok'
                          : 'pill-muted';
                    const query = new URLSearchParams({
                      accountId: a.id,
                      programId: p.id,
                      ...(from ? { from } : {}),
                      ...(to ? { to } : {}),
                    });
                    return (
                      <td key={p.id}>
                        <Link href={`/crosswalk/lines?${query}`} className={`pill ${style}`}>
                          {label}
                          {unmapped && lines.length ? ` · ${lines.join(', ')}` : ''}
                        </Link>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
