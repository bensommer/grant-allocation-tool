import Link from 'next/link';
import {
  Banner,
  ButtonLink,
  DataTable,
  DateText,
  EmptyState,
  NumTd,
  PageHeader,
  StatusPill,
  Th,
} from '@/components/ui';
import { prisma } from '@/lib/db';
import { getOrgId } from '@/lib/org';
import { currentPieces } from '../pieces';
import { dateRange } from '../range';

export const dynamic = 'force-dynamic';

export default async function CellLinesPage({
  searchParams,
}: {
  searchParams: Promise<{ accountId?: string; programId?: string; from?: string; to?: string }>;
}) {
  const { accountId, programId, from, to } = await searchParams;
  const orgId = await getOrgId();
  const range = from || to ? dateRange(from, to) : null;
  const [account, program, data] = await Promise.all([
    prisma.account.findFirst({ where: { orgId, id: accountId ?? '' } }),
    prisma.program.findFirst({ where: { orgId, id: programId ?? '' } }),
    currentPieces(orgId, range?.first ?? undefined, range?.last ?? undefined, {
      accountId: accountId ?? null,
      programId: programId ?? null,
    }),
  ]);
  const lines = data.pieces;
  return (
    <>
      <PageHeader
        title={`${program?.name ?? 'Program'} × ${account?.name ?? 'Account'}`}
        secondaryActions={
          <ButtonLink
            href={`/crosswalk/matrix${from || to ? `?${new URLSearchParams({ ...(from ? { from } : {}), ...(to ? { to } : {}) })}` : ''}`}
            variant="secondary"
          >
            Matrix
          </ButtonLink>
        }
      />
      {range?.error ? <Banner tone="bad">{range.error}</Banner> : null}
      {!data.run ? (
        <Banner tone="warn">
          No current run — recompute on <Link href="/runs">/runs</Link>.
        </Banner>
      ) : (
        <div className="card">
          {!lines.length ? (
            <EmptyState title="No expense in this cell" />
          ) : (
            <DataTable caption="Allocated lines">
              <thead>
                <tr>
                  {['Date', 'Doc', 'Description', 'Amount', 'Budget line', 'Status', 'Source'].map(
                    (h) => (
                      <Th key={h} num={h === 'Amount'}>
                        {h === 'Amount' ? 'Amount ($)' : h}
                      </Th>
                    ),
                  )}
                </tr>
              </thead>
              <tbody>
                {lines.map((l) => (
                  <tr key={l.id}>
                    <td>
                      <DateText date={l.sourceLine.transaction.txnDate} />
                    </td>
                    <td>{l.sourceLine.transaction.docNumber}</td>
                    <td>{l.sourceLine.description ?? l.sourceLine.transaction.memo}</td>
                    <NumTd cents={l.amountCents} />
                    <td>
                      {l.grantBudgetLine ? (
                        <>
                          {l.grantBudgetLine.name}
                          <span className="muted block text-xs">
                            {l.grantBudgetLine.grant.name}
                          </span>
                        </>
                      ) : (
                        'Unmapped'
                      )}
                    </td>
                    <td>
                      <StatusPill
                        tone={
                          l.status === 'crosswalk_conflict'
                            ? 'bad'
                            : !l.grantBudgetLineId && program?.functionalCategory === 'program'
                              ? 'warn'
                              : 'ok'
                        }
                      >
                        {l.status.replaceAll('_', ' ')}
                      </StatusPill>
                    </td>
                    <td>
                      <Link href={`/lines/${l.sourceLineId}`}>View line</Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </DataTable>
          )}
        </div>
      )}
    </>
  );
}
