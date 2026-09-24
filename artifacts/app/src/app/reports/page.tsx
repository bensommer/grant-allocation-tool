import Link from 'next/link';
import { PageHeader } from '@/components/page-header';
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
          run
            ? `Current run: ${(run.finishedAt ?? run.startedAt).toISOString().replace('T', ' ').slice(0, 19)} UTC`
            : 'No current run'
        }
        actions={
          <Link className="btn" href="/reports/custom">
            Build custom report
          </Link>
        }
      />
      {run?.stale ? (
        <div className="banner banner-warn">
          Configuration changed since the current run. Reports show numbers from{' '}
          {(run.finishedAt ?? run.startedAt).toISOString().replace('T', ' ').slice(0, 19)} UTC until
          you recompute.
        </div>
      ) : null}
      {saved ? <div className="banner banner-ok">Saved.</div> : null}
      {state?.errors.name || state?.errors.query ? (
        <div className="banner banner-bad">{state.errors.name ?? state.errors.query}</div>
      ) : null}
      <div className="card">
        <h2>Preset reports</h2>
        <ul>
          {presets.map((p) => (
            <li key={p.title}>
              <Link href={`/reports/custom?${p.query}`}>{p.title}</Link>
            </li>
          ))}
        </ul>
      </div>
      <div className="card">
        <h2>Saved views</h2>
        {views.length ? (
          <ul>
            {views.map((v) => (
              <li key={v.id}>
                <Link href={`${v.path}?${v.queryString}`}>{v.name}</Link>{' '}
                <form action={deleteView} className="inline">
                  <input type="hidden" name="id" value={v.id} />
                  <button className="btn btn-secondary btn-sm">Delete</button>
                </form>
              </li>
            ))}
          </ul>
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
      </div>
    </>
  );
}
