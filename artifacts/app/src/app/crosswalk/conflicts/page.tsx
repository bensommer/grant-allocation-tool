import Link from 'next/link';
import { PageHeader } from '@/components/page-header';
import { formatDate } from '@/domain/dates';
import { formatCents } from '@/domain/money';
import { prisma } from '@/lib/db';
import { getOrgId } from '@/lib/org';
import { currentPieces } from '../pieces';

export const dynamic = 'force-dynamic';

export default async function ConflictsPage() {
  const orgId = await getOrgId();
  const { run, pieces } = await currentPieces(orgId);
  const conflicts = pieces.filter((p) => p.status === 'crosswalk_conflict');
  const ids = [...new Set(conflicts.flatMap((p) => p.conflictRuleIds))];
  const rules = await prisma.crosswalkRule.findMany({
    where: { orgId, id: { in: ids } },
    select: { id: true, name: true },
  });
  const names = new Map(rules.map((r) => [r.id, r.name]));
  return (
    <>
      <PageHeader
        title="Crosswalk conflicts"
        actions={
          <Link href="/crosswalk" className="btn btn-secondary btn-sm">
            All rules
          </Link>
        }
      />
      {!run ? (
        <div className="banner banner-warn">
          No current run — recompute on <Link href="/runs">/runs</Link>.
        </div>
      ) : !conflicts.length ? (
        <div className="card muted">No conflicts.</div>
      ) : (
        <div className="card">
          <table>
            <thead>
              <tr>
                {['Date', 'Doc', 'Account', 'Program', 'Amount', 'Competing rules', 'Source'].map(
                  (h) => (
                    <th key={h}>{h}</th>
                  ),
                )}
              </tr>
            </thead>
            <tbody>
              {conflicts.map((p) => (
                <tr key={p.id}>
                  <td>{formatDate(p.sourceLine.transaction.txnDate)}</td>
                  <td>{p.sourceLine.transaction.docNumber}</td>
                  <td>
                    {p.sourceLine.account.number} {p.sourceLine.account.name}
                  </td>
                  <td>{p.program?.code ?? '—'}</td>
                  <td className="num">{formatCents(p.amountCents)}</td>
                  <td>
                    {p.conflictRuleIds.map((id, i) => (
                      <span key={id}>
                        {i ? ', ' : ''}
                        <Link href={`/crosswalk/${id}`}>{names.get(id) ?? '(deleted rule)'}</Link>
                      </span>
                    ))}
                  </td>
                  <td>
                    <Link href={`/lines/${p.sourceLineId}`}>View line</Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
