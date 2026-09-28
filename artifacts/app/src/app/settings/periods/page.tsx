import Link from 'next/link';
import { ButtonLink, Card, DataTable, DateText, PageHeader, Period } from '@/components/ui';
import { prisma } from '@/lib/db';
import { getOrgId } from '@/lib/org';
import { decodeFormState, pick } from '@/lib/forms';
import { createPeriodAction } from './actions';

export const dynamic = 'force-dynamic';
export default async function PeriodSettings({
  searchParams,
}: {
  searchParams: Promise<{ f?: string; saved?: string }>;
}) {
  const { f, saved } = await searchParams;
  const state = decodeFormState(f);
  const locks = await prisma.periodLock.findMany({
    where: { orgId: await getOrgId() },
    orderBy: { lockedAt: 'desc' },
  });
  return (
    <>
      <PageHeader
        title="Reporting period locks"
        subtitle="Snapshot the current compute run before sending a report."
      />
      {saved && <div className="banner banner-ok">Period locks saved.</div>}
      {state?.errors.name && <div className="banner banner-bad">{state.errors.name}</div>}
      <Card title="Lock a reporting period">
        <form action={createPeriodAction} className="grid-form">
          <label>
            Name
            <input name="name" required defaultValue={pick(state, 'name', '')} />
          </label>
          <label>
            From
            <input name="from" type="date" required defaultValue={pick(state, 'from', '')} />
          </label>
          <label>
            To
            <input name="to" type="date" required defaultValue={pick(state, 'to', '')} />
          </label>
          <label>
            Note
            <input name="note" defaultValue={pick(state, 'note', '')} />
          </label>
          <button className="btn">Lock period</button>
        </form>
      </Card>
      <Card title="Locked periods">
        <DataTable caption="Locked reporting periods">
          <thead>
            <tr>
              <th>Name</th>
              <th>Dates</th>
              <th>Snapshot</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {locks.map((lock) => (
              <tr key={lock.id}>
                <td>
                  <Link href={`/periods/${lock.id}/drift`}>{lock.name}</Link>
                </td>
                <td>
                  <Period from={lock.periodFrom} to={lock.periodTo} />
                </td>
                <td>
                  {lock.computeRunId ? (
                    <Link href={`/runs/${lock.computeRunId}`}>{lock.computeRunId.slice(-8)}</Link>
                  ) : (
                    <span className="muted">reported before the app</span>
                  )}
                </td>
                <td>
                  <ButtonLink
                    variant="secondary"
                    size="sm"
                    href={`/settings/periods/${lock.id}/delete`}
                  >
                    Manage lock
                  </ButtonLink>
                </td>
              </tr>
            ))}
          </tbody>
        </DataTable>
      </Card>
    </>
  );
}
