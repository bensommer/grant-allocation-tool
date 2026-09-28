import Link from 'next/link';
import { notFound } from 'next/navigation';
import { DataTable, DateText, Money, NumTd, PageHeader, StatusPill } from '@/components/ui';
import { prisma } from '@/lib/db';
import { getOrgId } from '@/lib/org';
import { parseMatchers } from '@/domain/matchers';
import { describeMatchers, loadLabelMaps } from '@/lib/matcher-labels';

export const dynamic = 'force-dynamic';

const STATUS: Record<string, { label: string; cls: string }> = {
  ok: { label: 'ok', cls: 'pill-ok' },
  allocation_conflict: { label: 'allocation conflict', cls: 'pill-bad' },
  crosswalk_conflict: { label: 'crosswalk conflict', cls: 'pill-bad' },
  unassigned_program: { label: 'unassigned program', cls: 'pill-warn' },
};

/**
 * Audit trail for one source line: as imported, which allocation rule split it,
 * the resulting pieces, and which crosswalk rule mapped each. Every number on
 * every report drills down to here.
 */
export default async function LineAuditPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ run?: string }>;
}) {
  const { id } = await params;
  const { run: runParam } = await searchParams;
  const orgId = await getOrgId();
  const line = await prisma.transactionLine.findFirst({
    where: { id, orgId },
    include: {
      account: true,
      class: true,
      location: true,
      party: true,
      transaction: {
        include: { party: true, importBatch: { select: { id: true, startedAt: true } } },
      },
    },
  });
  if (!line) notFound();
  const run = runParam
    ? await prisma.computeRun.findFirst({ where: { id: runParam, orgId } })
    : await prisma.computeRun.findFirst({ where: { orgId, isCurrent: true } });
  const pieces = run
    ? await prisma.allocatedLine.findMany({
        where: { computeRunId: run.id, sourceLineId: id },
        orderBy: { pieceIndex: 'asc' },
        include: {
          program: true,
          grant: { select: { id: true, name: true } },
          grantBudgetLine: { select: { code: true, name: true } },
          allocationRule: {
            include: {
              targets: {
                orderBy: { sortOrder: 'asc' },
                include: { program: true, grantBudgetLine: true },
              },
            },
          },
          crosswalkRule: true,
        },
      })
    : [];
  const conflictIds = [...new Set(pieces.flatMap((p) => p.conflictRuleIds))];
  const [conflictAlloc, conflictXwalk, labels] = await Promise.all([
    prisma.allocationRule.findMany({ where: { id: { in: conflictIds } } }),
    prisma.crosswalkRule.findMany({ where: { id: { in: conflictIds } } }),
    loadLabelMaps(orgId),
  ]);
  const allocRule = pieces.find((p) => p.allocationRule)?.allocationRule ?? null;
  const total = pieces.reduce((a, p) => a + p.amountCents, 0);
  const t = line.transaction;

  return (
    <>
      <PageHeader
        title={`Line ${t.docNumber ?? t.externalId} #${line.lineNumber}`}
        subtitle="Transaction as imported → shared cost split → crosswalk. Nothing here is editable; change rules and recompute instead."
      />

      <div className="card mb-4">
        <h2 className="mb-2">1 · Transaction (as imported, never modified)</h2>
        <DataTable caption="Imported transaction">
          <tbody>
            <tr>
              <th>Date</th>
              <td>
                <DateText date={t.txnDate} />
              </td>
              <th>Type / doc</th>
              <td>
                {t.txnType} {t.docNumber ?? ''}
              </td>
            </tr>
            <tr>
              <th>Account</th>
              <td>
                {line.account.name} <span className="muted">{line.account.number}</span>{' '}
                <span className="muted">({line.account.type})</span>
              </td>
              <th>Amount</th>
              <td data-cents={line.amountCents}>
                <Money cents={line.amountCents} />
              </td>
            </tr>
            <tr>
              <th>Class</th>
              <td>{line.class?.name ?? <span className="muted">none</span>}</td>
              <th>Location</th>
              <td>{line.location?.name ?? <span className="muted">none</span>}</td>
            </tr>
            <tr>
              <th>Party</th>
              <td>
                {line.party?.displayName ?? t.party?.displayName ?? (
                  <span className="muted">none</span>
                )}
              </td>
              <th>Description</th>
              <td>{line.description ?? t.memo ?? <span className="muted">—</span>}</td>
            </tr>
            <tr>
              <th>Source id</th>
              <td>{t.externalId}</td>
              <th>Import batch</th>
              <td>
                <Link href={`/import/${t.importBatch.id}`}>
                  <DateText date={t.importBatch.startedAt} time />
                </Link>
                {t.deletedAt ? <span className="pill pill-bad ml-2">deleted in source</span> : null}
              </td>
            </tr>
          </tbody>
        </DataTable>
      </div>

      {!run ? (
        <div className="banner banner-warn">
          No compute run yet — <Link href="/runs">recompute</Link> to see how this line is
          allocated.
        </div>
      ) : (
        <>
          <div className="card mb-4">
            <h2 className="mb-2">2 · Allocation</h2>
            <p className="muted mb-2 text-xs">
              Run <DateText date={run.startedAt} time /> · {run.isCurrent ? 'current' : run.status}
              {run.stale ? ' · stale (config changed since)' : ''}
            </p>
            {allocRule ? (
              <p>
                Split by rule <Link href={`/allocation/${allocRule.id}`}>{allocRule.name}</Link>{' '}
                (priority {allocRule.priority},{' '}
                {allocRule.method === 'fixed_pct'
                  ? 'fixed %'
                  : `driver ratio: ${allocRule.driverKey}`}
                ) — matches when{' '}
                {describeMatchers(parseMatchers(allocRule.matchers), labels).toLowerCase()}.
              </p>
            ) : pieces[0]?.status === 'allocation_conflict' ? (
              <p>
                <span className="pill pill-bad">allocation conflict</span> — these rules share the
                lowest priority, so none was applied and the line fell through to its class default:{' '}
                {conflictAlloc.map((r, i) => (
                  <span key={r.id}>
                    {i > 0 ? ', ' : ''}
                    <Link href={`/allocation/${r.id}`}>{r.name}</Link>
                  </span>
                ))}
              </p>
            ) : (
              <p>
                No shared cost split matched. Assigned 100% to the program whose default class mapping
                includes <strong>{line.class?.name ?? 'no class'}</strong>
                {pieces[0]?.program ? (
                  <>
                    {' '}
                    →{' '}
                    <Link href={`/programs/${pieces[0].program.id}`}>
                      {pieces[0].program.name}
                    </Link>{' '}
                    <span className="muted">{pieces[0].program.code}</span>.
                  </>
                ) : (
                  <>
                    {' '}
                    — <span className="pill pill-warn">no program claims this class</span>
                  </>
                )}
              </p>
            )}
          </div>

          <div className="card">
            <h2 className="mb-2">3 · Resulting allocated amounts and crosswalk</h2>
            <DataTable caption="Allocated amounts and crosswalk">
              <thead>
                <tr>
                  <th>#</th>
                  <th>Program</th>
                  <th className="num">Amount</th>
                  <th>Grant budget line</th>
                  <th>Mapped by</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {pieces.map((p) => {
                  const st = STATUS[p.status] ?? { label: p.status, cls: 'pill-muted' };
                  const xConflicts = conflictXwalk.filter((r) => p.conflictRuleIds.includes(r.id));
                  return (
                    <tr key={p.id}>
                      <td>{p.pieceIndex + 1}</td>
                      <td>
                        {p.program ? (
                          <>
                            <Link href={`/programs/${p.program.id}`}>{p.program.name}</Link>{' '}
                            <span className="muted">{p.program.code}</span>
                          </>
                        ) : (
                          <span className="muted">unassigned</span>
                        )}
                      </td>
                      <NumTd cents={p.amountCents} />
                      <td>
                        {p.grant && p.grantBudgetLine ? (
                          <Link href={`/grants/${p.grant.id}/budget`}>
                            {p.grant.name} · {p.grantBudgetLine.name}{' '}
                            <span className="muted">{p.grantBudgetLine.code}</span>
                          </Link>
                        ) : line.account.type === 'Expense' ||
                          line.account.type === 'COGS' ||
                          line.account.type === 'OtherExpense' ? (
                          <span className="muted">unmapped</span>
                        ) : (
                          <span className="muted">n/a (not expense)</span>
                        )}
                      </td>
                      <td>
                        {p.crosswalkRule ? (
                          <Link href={`/crosswalk/${p.crosswalkRule.id}`}>
                            {p.crosswalkRule.name}
                          </Link>
                        ) : p.grantBudgetLineId && p.allocationRuleId ? (
                          <span className="muted">shared cost split target</span>
                        ) : xConflicts.length > 0 ? (
                          <>
                            tie between{' '}
                            {xConflicts.map((r, i) => (
                              <span key={r.id}>
                                {i > 0 ? ', ' : ''}
                                <Link href={`/crosswalk/${r.id}`}>{r.name}</Link>
                              </span>
                            ))}
                          </>
                        ) : (
                          <span className="muted">—</span>
                        )}
                      </td>
                      <td>
                        <StatusPill
                          tone={
                            st.cls === 'pill-ok' ? 'ok' : st.cls === 'pill-bad' ? 'bad' : 'warn'
                          }
                        >
                          {st.label}
                        </StatusPill>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr>
                  <th colSpan={2}>Σ allocated amounts</th>
                  <th className="num" data-cents={total}>
                    <Money cents={total} dollar />
                  </th>
                  <th colSpan={3} className="font-normal">
                    {total === line.amountCents ? (
                      <span className="pill pill-ok">equals source amount</span>
                    ) : (
                      <span className="pill pill-bad">
                        does not equal source — invariant violated
                      </span>
                    )}
                  </th>
                </tr>
              </tfoot>
            </DataTable>
          </div>
        </>
      )}
    </>
  );
}
