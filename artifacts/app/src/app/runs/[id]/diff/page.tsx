import Link from 'next/link';
import { notFound } from 'next/navigation';
import { DataTable, DateText, NumTd, PageHeader } from '@/components/ui';
import { prisma } from '@/lib/db';
import { getOrgId } from '@/lib/org';

export const dynamic = 'force-dynamic';

interface Cell {
  programId: string | null;
  accountId: string;
  cents: number;
}

async function programGl(runId: string): Promise<Cell[]> {
  const rows = await prisma.$queryRaw<
    Array<{ programId: string | null; accountId: string; cents: bigint | number }>
  >`
    SELECT al."programId", tl."accountId", SUM(al."amountCents") AS cents
    FROM "AllocatedLine" al JOIN "TransactionLine" tl ON tl.id = al."sourceLineId"
    WHERE al."computeRunId" = ${runId}
    GROUP BY al."programId", tl."accountId"`;
  return rows.map((r) => ({
    programId: r.programId,
    accountId: r.accountId,
    cents: Number(r.cents),
  }));
}

async function grantLines(
  runId: string,
): Promise<Array<{ grantBudgetLineId: string; cents: number }>> {
  const rows = await prisma.$queryRaw<Array<{ grantBudgetLineId: string; cents: bigint | number }>>`
    SELECT "grantBudgetLineId", SUM("amountCents") AS cents FROM "AllocatedLine"
    WHERE "computeRunId" = ${runId} AND "grantBudgetLineId" IS NOT NULL AND status <> 'crosswalk_conflict'
    GROUP BY "grantBudgetLineId"`;
  return rows.map((r) => ({ grantBudgetLineId: r.grantBudgetLineId, cents: Number(r.cents) }));
}

export default async function RunDiffPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ against?: string }>;
}) {
  const { id } = await params;
  const { against } = await searchParams;
  const orgId = await getOrgId();
  const run = await prisma.computeRun.findFirst({ where: { id, orgId } });
  if (!run) notFound();
  const base = against
    ? await prisma.computeRun.findFirst({ where: { id: against, orgId } })
    : null;
  if (!base) {
    return (
      <>
        <PageHeader title="Run diff" subtitle="Pick a run to compare against." />
        <div className="banner banner-warn">
          Missing or unknown ?against= run. <Link href={`/runs/${id}`}>Back to run</Link>.
        </div>
      </>
    );
  }

  const [a, b, ga, gb, programs, accounts, budgetLines] = await Promise.all([
    programGl(run.id),
    programGl(base.id),
    grantLines(run.id),
    grantLines(base.id),
    prisma.program.findMany({ where: { orgId }, select: { id: true, code: true, name: true } }),
    prisma.account.findMany({ where: { orgId }, select: { id: true, number: true, name: true } }),
    prisma.grantBudgetLine.findMany({
      where: { orgId },
      include: { grant: { select: { name: true } } },
    }),
  ]);
  const progCode = new Map(programs.map((p) => [p.id, `${p.name} · ${p.code}`]));
  const acctLabel = new Map(
    accounts.map((x) => [x.id, x.number ? `${x.name} · ${x.number}` : x.name]),
  );
  const blLabel = new Map(
    budgetLines.map((x) => [x.id, `${x.grant.name} · ${x.name} · ${x.code}`]),
  );

  const key = (c: Cell) => `${c.accountId}|${c.programId ?? ''}`;
  const after = new Map(a.map((c) => [key(c), c]));
  const before = new Map(b.map((c) => [key(c), c]));
  const keys = [...new Set([...after.keys(), ...before.keys()])];
  const deltas = keys
    .map((k) => {
      const x = after.get(k);
      const y = before.get(k);
      const accountId = (x ?? y)!.accountId;
      const programId = (x ?? y)!.programId;
      return {
        accountId,
        programId,
        before: y?.cents ?? 0,
        after: x?.cents ?? 0,
        delta: (x?.cents ?? 0) - (y?.cents ?? 0),
      };
    })
    .filter((d) => d.delta !== 0)
    .sort(
      (p, q) =>
        (acctLabel.get(p.accountId) ?? '').localeCompare(acctLabel.get(q.accountId) ?? '') ||
        (progCode.get(p.programId ?? '') ?? 'zzz').localeCompare(
          progCode.get(q.programId ?? '') ?? 'zzz',
        ),
    );

  const gAfter = new Map(ga.map((g) => [g.grantBudgetLineId, g.cents]));
  const gBefore = new Map(gb.map((g) => [g.grantBudgetLineId, g.cents]));
  const gDeltas = [...new Set([...gAfter.keys(), ...gBefore.keys()])]
    .map((k) => ({
      id: k,
      before: gBefore.get(k) ?? 0,
      after: gAfter.get(k) ?? 0,
      delta: (gAfter.get(k) ?? 0) - (gBefore.get(k) ?? 0),
    }))
    .filter((d) => d.delta !== 0)
    .sort((p, q) => (blLabel.get(p.id) ?? '').localeCompare(blLabel.get(q.id) ?? ''));

  return (
    <>
      <PageHeader
        title="Why did this number change?"
        subtitle={
          <>
            Run <DateText date={run.startedAt} time /> ({run.configHash}) compared with{' '}
            <DateText date={base.startedAt} time /> ({base.configHash}). Positive delta = more in
            the newer run.
          </>
        }
        secondaryActions={
          <Link href={`/runs/${id}`} className="btn btn-secondary btn-sm">
            Back to run
          </Link>
        }
      />
      {run.configHash === base.configHash ? (
        <div className="banner banner-ok">
          Same configuration hash — any differences below come from changed source data.
        </div>
      ) : null}
      <div className="card mb-4">
        <h2 className="mb-2">Program × GL account</h2>
        {deltas.length === 0 ? (
          <p className="muted">No differences.</p>
        ) : (
          <DataTable caption="Program and GL account changes">
            <thead>
              <tr>
                <th>GL account</th>
                <th>Program</th>
                <th className="num">Before</th>
                <th className="num">After</th>
                <th className="num">Delta</th>
              </tr>
            </thead>
            <tbody>
              {deltas.map((d) => (
                <tr key={`${d.accountId}|${d.programId}`}>
                  <td>{acctLabel.get(d.accountId) ?? d.accountId}</td>
                  <td>
                    {d.programId ? (
                      (progCode.get(d.programId) ?? d.programId)
                    ) : (
                      <span className="muted">unassigned</span>
                    )}
                  </td>
                  <NumTd cents={d.before} />
                  <NumTd cents={d.after} />
                  <NumTd cents={d.delta} />
                </tr>
              ))}
            </tbody>
          </DataTable>
        )}
      </div>
      <div className="card">
        <h2 className="mb-2">Grant budget lines</h2>
        {gDeltas.length === 0 ? (
          <p className="muted">No differences.</p>
        ) : (
          <DataTable caption="Grant budget line changes">
            <thead>
              <tr>
                <th>Budget line</th>
                <th className="num">Before</th>
                <th className="num">After</th>
                <th className="num">Delta</th>
              </tr>
            </thead>
            <tbody>
              {gDeltas.map((d) => (
                <tr key={d.id}>
                  <td>{blLabel.get(d.id) ?? d.id}</td>
                  <NumTd cents={d.before} />
                  <NumTd cents={d.after} />
                  <NumTd cents={d.delta} />
                </tr>
              ))}
            </tbody>
          </DataTable>
        )}
      </div>
    </>
  );
}
