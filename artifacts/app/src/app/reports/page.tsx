import Link from 'next/link';
import { StaleRunBanner } from '@/components/stale-run-banner';
import {
  Button,
  ButtonLink,
  Card,
  DataTable,
  DateText,
  PageHeader,
  PeriodSubtitle,
  Th,
} from '@/components/ui';
import { currentPeriod } from '@/lib/period';
import { prisma } from '@/lib/db';
import { getOrgId } from '@/lib/org';
import { decodeFormState } from '@/lib/forms';
import { presets } from '@/reports/presets';
import { deleteView } from './actions';

export const dynamic = 'force-dynamic';
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ f?: string; saved?: string; asOf?: string }>;
}) {
  const { f, saved, asOf } = await searchParams;
  const orgId = await getOrgId();
  const [views, run, period] = await Promise.all([
    prisma.savedView.findMany({ where: { orgId }, orderBy: { createdAt: 'desc' } }),
    prisma.computeRun.findFirst({ where: { orgId, isCurrent: true } }),
    currentPeriod(orgId, { asOf }),
  ]);
  const presetLinks = presets(period.range);
  const state = decodeFormState(f);
  return (
    <>
      <PageHeader
        title="Reports"
        subtitle={
          <>
            <PeriodSubtitle
              from={period.range.from}
              to={period.range.to}
              booksThrough={period.booksThrough}
            />
            {run ? (
              <>
                {' '}
                · Current run: <DateText date={run.finishedAt ?? run.startedAt} time />
              </>
            ) : (
              ' · No current run'
            )}
          </>
        }
        primaryAction={<ButtonLink href="/reports/custom">Build custom report</ButtonLink>}
      />
      <StaleRunBanner run={run} />
      {saved ? <div className="banner banner-ok">Saved.</div> : null}
      {state?.errors.name || state?.errors.query ? (
        <div className="banner banner-bad">{state.errors.name ?? state.errors.query}</div>
      ) : null}
      <Card title="Overview">
        <p>
          <Link href="/reports/overview" data-testid="overview-link">
            Overview dashboard
          </Link>{' '}
          <span className="muted text-sm">
            — restricted balances, flagged grants, unmapped and non-grant expense, health checks
          </span>
        </p>
      </Card>
      <Card title="Preset reports">
        <ul>
          {presetLinks.map((p) => (
            <li key={p.title}>
              <Link href={`/reports/custom?${p.query}`} data-testid="preset-link">
                {p.title}
              </Link>
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
        <p className="muted mt-3 text-sm">
          To save a view, open a report and use “Save current view” above its table.
        </p>
      </Card>
    </>
  );
}
