import Link from 'next/link';
import { PageHeader } from '@/components/page-header';
import { formatDate } from '@/domain/dates';
import { formatCents } from '@/domain/money';
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
        title={`${program?.code ?? 'Program'} × ${account?.number ?? 'Account'}`}
        actions={
          <Link
            href={`/crosswalk/matrix${from || to ? `?${new URLSearchParams({ ...(from ? { from } : {}), ...(to ? { to } : {}) })}` : ''}`}
            className="btn btn-secondary btn-sm"
          >
            Matrix
          </Link>
        }
      />
      {range?.error ? <div className="banner banner-bad">{range.error}</div> : null}
      {!data.run ? (
        <div className="banner banner-warn">
          No current run — recompute on <Link href="/runs">/runs</Link>.
        </div>
      ) : (
        <div className="card">
          {!lines.length ? (
            <p className="muted">No pieces in this cell.</p>
          ) : (
            <table>
              <thead>
                <tr>
                  {['Date', 'Doc', 'Description', 'Amount', 'Budget line', 'Status', 'Source'].map(
                    (h) => (
                      <th key={h}>{h}</th>
                    ),
                  )}
                </tr>
              </thead>
              <tbody>
                {lines.map((l) => (
                  <tr key={l.id}>
                    <td>{formatDate(l.sourceLine.transaction.txnDate)}</td>
                    <td>{l.sourceLine.transaction.docNumber}</td>
                    <td>{l.sourceLine.description ?? l.sourceLine.transaction.memo}</td>
                    <td className="num">{formatCents(l.amountCents)}</td>
                    <td>
                      {l.grantBudgetLine
                        ? `${l.grantBudgetLine.grant.awardNumber ?? l.grantBudgetLine.grant.name}/${l.grantBudgetLine.code}`
                        : 'Unmapped'}
                    </td>
                    <td>{l.status}</td>
                    <td>
                      <Link href={`/lines/${l.sourceLineId}`}>View line</Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
    </>
  );
}
