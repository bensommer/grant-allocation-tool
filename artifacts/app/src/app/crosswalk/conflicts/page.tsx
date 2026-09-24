import Link from 'next/link';
import {
  Banner,
  ButtonLink,
  DataTable,
  DateText,
  EmptyState,
  NumTd,
  PageHeader,
  Th,
} from '@/components/ui';
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
        secondaryActions={
          <ButtonLink href="/crosswalk" variant="secondary">
            All rules
          </ButtonLink>
        }
      />
      {!run ? (
        <Banner tone="warn">
          No current run — recompute on <Link href="/runs">/runs</Link>.
        </Banner>
      ) : !conflicts.length ? (
        <EmptyState title="No conflicts" />
      ) : (
        <div className="card">
          <DataTable caption="Conflicting lines">
            <thead>
              <tr>
                {['Date', 'Doc', 'Account', 'Program', 'Amount', 'Competing rules', 'Source'].map(
                  (h) => (
                    <Th key={h} num={h === 'Amount'}>
                      {h === 'Amount' ? 'Amount ($)' : h}
                    </Th>
                  ),
                )}
              </tr>
            </thead>
            <tbody>
              {conflicts.map((p) => (
                <tr key={p.id}>
                  <td>
                    <DateText date={p.sourceLine.transaction.txnDate} />
                  </td>
                  <td>{p.sourceLine.transaction.docNumber}</td>
                  <td>
                    {p.sourceLine.account.name}
                    <span className="muted block text-xs">{p.sourceLine.account.number}</span>
                  </td>
                  <td>{p.program?.name ?? '—'}</td>
                  <NumTd cents={p.amountCents} />
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
          </DataTable>
        </div>
      )}
    </>
  );
}
