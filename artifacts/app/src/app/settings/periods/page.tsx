import Link from 'next/link';
import { PageHeader } from '@/components/page-header';
import { prisma } from '@/lib/db';
import { getOrgId } from '@/lib/org';
import { decodeFormState, pick } from '@/lib/forms';
import { createPeriodAction, deletePeriodAction } from './actions';

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
      <div className="card mb-4">
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
          <button className="btn">Lock current run</button>
        </form>
      </div>
      <div className="card">
        <h2>Locked periods</h2>
        <table>
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
                  {lock.periodFrom.toISOString().slice(0, 10)} –{' '}
                  {lock.periodTo.toISOString().slice(0, 10)}
                </td>
                <td>
                  <Link href={`/runs/${lock.computeRunId}`}>{lock.computeRunId.slice(-8)}</Link>
                </td>
                <td>
                  <form action={deletePeriodAction}>
                    <input type="hidden" name="id" value={lock.id} />
                    <button className="btn btn-secondary btn-sm">Delete</button>
                  </form>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
