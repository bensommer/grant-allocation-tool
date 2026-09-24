import Link from 'next/link';
import { PageHeader } from '@/components/page-header';
import { formatCents } from '@/domain/money';
import { prisma } from '@/lib/db';
import { getOrgId } from '@/lib/org';
import { bvaData, reportDate } from '@/services/bva';

export const dynamic = 'force-dynamic';

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ asOf?: string }>;
}) {
  const orgId = await getOrgId();
  const { label, date } = reportDate((await searchParams).asOf);
  const [{ run, grants }, lastImport] = await Promise.all([
    bvaData(orgId, date),
    prisma.importBatch.findFirst({ where: { orgId }, orderBy: { startedAt: 'desc' } }),
  ]);
  const flagged = grants.filter((g) => g.flagged);
  const restricted = grants.filter((g) => g.restrictionType !== 'unrestricted');
  const unmapped = run
    ? await prisma.allocatedLine.findMany({
        where: {
          orgId,
          computeRunId: run.id,
          programId: { not: null },
          grantBudgetLineId: null,
          status: 'ok',
          sourceLine: {
            account: { type: { in: ['Expense', 'COGS', 'OtherExpense'] } },
            transaction: { orgId, deletedAt: null },
          },
        },
        select: {
          amountCents: true,
          programId: true,
          program: { select: { code: true, name: true } },
          sourceLine: { select: { transaction: { select: { txnDate: true } } } },
        },
      })
    : [];
  const groups = new Map<string, { name: string; amount: number }>();
  for (const piece of unmapped) {
    const key = piece.programId!;
    const prev = groups.get(key);
    groups.set(key, {
      name: `${piece.program?.code} · ${piece.program?.name}`,
      amount: (prev?.amount ?? 0) + piece.amountCents,
    });
  }
  const monthly = new Map<string, number>();
  if (run) {
    const expenses = await prisma.allocatedLine.findMany({
      where: {
        orgId,
        computeRunId: run.id,
        status: 'ok',
        sourceLine: {
          account: { type: { in: ['Expense', 'COGS', 'OtherExpense'] } },
          transaction: { orgId, deletedAt: null },
        },
      },
      select: {
        amountCents: true,
        sourceLine: { select: { transaction: { select: { txnDate: true } } } },
      },
    });
    for (const p of expenses) {
      const key = p.sourceLine.transaction.txnDate.toISOString().slice(0, 7);
      monthly.set(key, (monthly.get(key) ?? 0) + p.amountCents);
    }
  }
  const values = [...monthly].sort(([a], [b]) => a.localeCompare(b));
  const max = Math.max(1, ...values.map(([, n]) => n));
  const points = values
    .map(
      ([, n], i) =>
        `${values.length === 1 ? 100 : (i * 200) / (values.length - 1)},${50 - (n * 45) / max}`,
    )
    .join(' ');
  return (
    <>
      <PageHeader
        title="Dashboard"
        subtitle={`As of ${label} · Current run: ${run ? (run.finishedAt ?? run.startedAt).toISOString().replace('T', ' ').slice(0, 19) + ' UTC' : 'none'}`}
      />
      {run?.stale && (
        <div className="banner banner-warn">
          Configuration changed since the current run. Reports show numbers from{' '}
          {(run.finishedAt ?? run.startedAt).toISOString().replace('T', ' ').slice(0, 19)} UTC until
          you recompute.
        </div>
      )}
      {!run && (
        <div className="banner banner-warn">
          No current run — recompute on <Link href="/runs">/runs</Link>.
        </div>
      )}
      <form method="get" className="mb-4">
        <label>
          As of <input name="asOf" type="date" defaultValue={label} />
        </label>{' '}
        <button className="btn btn-secondary">Apply</button>
      </form>
      <div className="grid gap-4 md:grid-cols-2">
        <div className="card">
          <h2>
            <Link href={`/restricted?asOf=${label}`}>Restricted balances</Link>
          </h2>
          <p className="text-2xl font-semibold">
            {formatCents(restricted.reduce((n, g) => n + g.balance, 0))}
          </p>
          <p className="muted text-sm">
            Received minus spent on restricted grants. A negative balance means spent ahead of
            receipts.
          </p>
        </div>
        <div className="card">
          <h2>Flagged grants</h2>
          <p className="text-2xl font-semibold">{flagged.length}</p>
          <ul>
            {flagged.map((g) => (
              <li key={g.id}>
                <Link href={`/grants/${g.id}/bva?asOf=${label}`}>{g.name}</Link> · {g.pace.flag}
                {g.rows.some((r) => r.overBudget) ? ' · over-budget line' : ''}
              </li>
            ))}
          </ul>
        </div>
        <div className="card">
          <h2>
            <Link href="/crosswalk/coverage">Unmapped program expense</Link>
          </h2>
          <p className="text-2xl font-semibold">
            {formatCents(unmapped.reduce((n, p) => n + p.amountCents, 0))}
          </p>
          <ul>
            {[...groups].map(([key, row]) => (
              <li key={key}>
                {row.name}: {formatCents(row.amount)}
              </li>
            ))}
          </ul>
        </div>
        <div className="card">
          <h2>Activity</h2>
          <p>
            Last import:{' '}
            {lastImport
              ? `${(lastImport.finishedAt ?? lastImport.startedAt).toISOString().replace('T', ' ').slice(0, 19)} UTC · ${lastImport.status}`
              : 'None'}
          </p>
          <p>
            Last compute:{' '}
            {run
              ? `${(run.finishedAt ?? run.startedAt).toISOString().replace('T', ' ').slice(0, 19)} UTC${run.stale ? ' · stale' : ''}`
              : 'None'}
          </p>
          <Link href="/runs">Compute runs</Link>
        </div>
      </div>
      <div className="card mt-4">
        <h2>Monthly expense</h2>
        <svg
          viewBox="0 0 200 55"
          role="img"
          aria-label="Monthly total expense sparkline"
          className="h-16 w-full"
        >
          <polyline fill="none" stroke="currentColor" strokeWidth="2" points={points} />
        </svg>
        <p className="muted text-sm">
          {values.map(([month, cents]) => `${month}: ${formatCents(cents)}`).join(' · ') ||
            'No expense data'}
        </p>
      </div>
      <p className="muted mt-4 text-sm">
        Flagged means spending is outside configured straight-line pacing thresholds or a budget
        line is over budget. Totals use current-run expense allocations; income receipts are read
        from matching source lines.
      </p>
    </>
  );
}
