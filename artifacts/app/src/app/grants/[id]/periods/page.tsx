import Link from 'next/link';
import { notFound } from 'next/navigation';
import {
  Banner,
  ButtonLink,
  Card,
  DataTable,
  DateText,
  EmptyState,
  Money,
  NumTd,
  PageHeader,
  Period,
  StatusPill,
  Td,
  Th,
} from '@/components/ui';
import { RELEASE_CLASSES, RELEASE_CLASS_LABEL } from '@/domain/periods';
import { getOrgId } from '@/lib/org';
import { grantPeriodSnapshots, periodDrift } from '@/services/grant-periods';
import { grantHeader } from '@/services/grant-workspace';
import { GrantTabs } from '../tabs';

export const dynamic = 'force-dynamic';

/** Closed periods of the grant: the figures of record and how today's books drift from them. */
export default async function GrantPeriodsPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ saved?: string }>;
}) {
  const { id } = await params;
  const { saved } = await searchParams;
  const orgId = await getOrgId();
  const grant = await grantHeader(orgId, id);
  if (!grant) notFound();
  const [snapshots, drift] = await Promise.all([
    grantPeriodSnapshots(orgId, id),
    periodDrift(orgId, id),
  ]);
  return (
    <>
      <PageHeader
        title={grant.name}
        subtitle={
          <>
            {grant.funder} · <Period from={grant.startDate} to={grant.endDate} />
          </>
        }
        secondaryActions={
          <ButtonLink href={`/grants/${id}/periods/reported`} variant="secondary">
            Record a reported period
          </ButtonLink>
        }
      />
      <GrantTabs id={id} active="periods" />
      {saved && <Banner tone="ok">Reported period saved.</Banner>}
      <Card
        title="Closed periods"
        action={
          <Link href="/settings/periods" className="text-sm">
            Lock a period →
          </Link>
        }
      >
        {snapshots.length === 0 ? (
          <EmptyState
            title="No closed periods"
            hint="Lock a period once a report has gone out, or record a period that was reported before the app existed."
          />
        ) : (
          <DataTable>
            <thead>
              <tr>
                <Th>Period</Th>
                <Th>Source</Th>
                <Th num>Received ($)</Th>
                {RELEASE_CLASSES.map((c) => (
                  <Th key={c} num>
                    {RELEASE_CLASS_LABEL[c]} ($)
                  </Th>
                ))}
                <Th num>Released ($)</Th>
                <Th>Note</Th>
              </tr>
            </thead>
            <tbody>
              {snapshots.map((s) => (
                <tr key={s.lockId} data-testid="period-snapshot" data-source={s.source}>
                  <Td>
                    {s.name}
                    <span className="muted block text-xs">
                      <Period from={s.periodFrom} to={s.periodTo} />
                    </span>
                  </Td>
                  <Td>
                    <StatusPill tone={s.source === 'reported' ? 'info' : 'muted'}>
                      {s.source === 'reported' ? 'reported' : 'computed at lock'}
                    </StatusPill>
                    <span className="muted block text-xs">
                      {s.actor} · <DateText date={s.createdAt} />
                    </span>
                  </Td>
                  <NumTd cents={s.receivedCents} data-testid="snapshot-received" />
                  {RELEASE_CLASSES.map((c) => (
                    <NumTd key={c} cents={s.released[c]} data-testid={`snapshot-${c}`} />
                  ))}
                  <NumTd
                    cents={s.released.direct + s.released.staff + s.released.overhead}
                    data-testid="snapshot-released"
                  />
                  <Td className="max-w-xs text-sm">{s.note ?? <span className="muted">—</span>}</Td>
                </tr>
              ))}
            </tbody>
          </DataTable>
        )}
        <p className="muted mt-2 text-xs">
          Closed periods are never recomputed. A recompute changes today&apos;s books, not these
          figures; re-recording a period supersedes its earlier rows and keeps them for audit.
        </p>
      </Card>

      {drift.length > 0 && (
        <Card title="Drift: today's books vs. the period as closed">
          <DataTable>
            <thead>
              <tr>
                <Th>Period</Th>
                <Th>Class</Th>
                <Th num>As closed ($)</Th>
                <Th num>Books today ($)</Th>
                <Th num>Difference ($)</Th>
                <Th>Note</Th>
              </tr>
            </thead>
            <tbody>
              {drift.map((d) => (
                <tr key={`${d.period.lockId}-${d.cls}`} data-testid="drift-row" data-class={d.cls}>
                  <Td>{d.period.name}</Td>
                  <Td>{RELEASE_CLASS_LABEL[d.cls]}</Td>
                  <NumTd cents={d.reportedCents} data-testid="drift-reported" />
                  {d.booksCents === null ? (
                    <Td className="muted text-sm" colSpan={2} data-testid="drift-not-computed">
                      not computed: effort charges are not dated per period
                    </Td>
                  ) : (
                    <>
                      <NumTd cents={d.booksCents} data-testid="drift-books" />
                      <NumTd
                        cents={d.driftCents ?? 0}
                        className={d.driftCents ? 'text-bad' : undefined}
                        data-testid="drift-diff"
                      />
                    </>
                  )}
                  <Td className="text-sm">
                    {d.driftCents === null ? (
                      <span className="muted">—</span>
                    ) : d.driftCents === 0 ? (
                      <StatusPill tone="ok">ties</StatusPill>
                    ) : (
                      <span className="muted">
                        Books differ by <Money cents={Math.abs(d.driftCents)} />; the closed figure
                        stands. Add context when re-recording the period.
                      </span>
                    )}
                  </Td>
                </tr>
              ))}
            </tbody>
          </DataTable>
        </Card>
      )}
    </>
  );
}
