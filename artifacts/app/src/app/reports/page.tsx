import Link from 'next/link';
import { Button, ButtonLink, Card, DataTable, DateText, PageHeader, Th } from '@/components/ui';
import { prisma } from '@/lib/db';
import { getOrgId } from '@/lib/org';
import { decodeFormState, pick } from '@/lib/forms';
import { presets } from '@/reports/presets';
import { deleteView, saveView } from './actions';

export const dynamic = 'force-dynamic';
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ f?: string; saved?: string }>;
}) {
  const { f, saved } = await searchParams;
  const orgId = await getOrgId();
  const [views, run] = await Promise.all([
    prisma.savedView.findMany({ where: { orgId }, orderBy: { createdAt: 'desc' } }),
    prisma.computeRun.findFirst({ where: { orgId, isCurrent: true } }),
  ]);
  const state = decodeFormState(f);
  return (
    <>
      <PageHeader
        title="Reports"
        subtitle={
          run ? (
            <>
              Current run: <DateText date={run.finishedAt ?? run.startedAt} time />
            </>
          ) : (
            'No current run'
          )
        }
        primaryAction={<ButtonLink href="/reports/custom">Build custom report</ButtonLink>}
      />
      {run?.stale ? (
        <div className="banner banner-warn">
          Configuration changed since the current run. Reports show numbers from{' '}
          <DateText date={run.finishedAt ?? run.startedAt} time /> until you recompute.
        </div>
      ) : null}
      {saved ? <div className="banner banner-ok">Saved.</div> : null}
      {state?.errors.name || state?.errors.query ? (
        <div className="banner banner-bad">{state.errors.name ?? state.errors.query}</div>
      ) : null}
      <Card title="Preset reports">
        <ul>
          {presets.map((p) => (
            <li key={p.title}>
              <Link href={`/reports/custom?${p.query}`}>{p.title}</Link>
            </li>
          ))}
        </ul>
      </Card>
      <Card title="Saved views">
        {views.length ? (
          <DataTable caption="Saved report views">
            <thead>
              <tr>
                <Th>View</Th>
                <Th>Actions</Th>
              </tr>
            </thead>
            <tbody>
              {views.map((v) => (
                <tr key={v.id}>
                  <td>
                    <Link href={`${v.path}?${v.queryString}`}>{v.name}</Link>
                  </td>
                  <td>
                    <form action={deleteView} className="inline">
                      <input type="hidden" name="id" value={v.id} />
                      <Button variant="secondary" size="sm">
                        Delete
                      </Button>
                    </form>
                  </td>
                </tr>
              ))}
            </tbody>
          </DataTable>
        ) : (
          <p className="muted">No saved views yet.</p>
        )}
        <form action={saveView}>
          <label>
            View name <input name="name" required defaultValue={pick(state, 'name', '')} />
          </label>{' '}
          <label>
            Report query string{' '}
            <input name="query" required defaultValue={pick(state, 'query', presets[0]!.query)} />
          </label>{' '}
          <button className="btn">Save current view</button>
        </form>
      </Card>
    </>
  );
}
