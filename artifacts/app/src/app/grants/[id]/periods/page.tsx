import Link from 'next/link';
import { notFound } from 'next/navigation';
import {
  Banner,
  Button,
  ButtonLink,
  Card,
  DataTable,
  DateText,
  EmptyState,
  Footnote,
  FootnoteMark,
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
import { updateReportedNoteAction } from './actions';

export const dynamic = 'force-dynamic';

/**
 * Closed periods of the grant: the figures of record and how today's books drift from
 * them. Reported periods are locked — only their note can change. Drift is
 * informational, so it stays neutral grey rather than red.
 */
export default async function GrantPeriodsPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ saved?: string; noted?: string }>;
}) {
  const { id } = await params;
  const { saved, noted } = await searchParams;
  const orgId = await getOrgId();
  const grant = await grantHeader(orgId, id);
  if (!grant) notFound();
  const [snapshots, drift] = await Promise.all([
    grantPeriodSnapshots(orgId, id),
    periodDrift(orgId, id),
  ]);
  const hasNotComputed = drift.some((d) => d.booksCents === null);
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
      {noted && <Banner tone="ok">Note saved.</Banner>}
      <Card
        title="Closed periods"
        action={
          <span className="flex gap-4 text-sm">
            <Link href="/grants/rollforward" data-testid="rollforward-link">
              Restricted rollforward →
            </Link>
            <Link href="/settings/periods">Lock a period →</Link>
          </span>
        }
      >
        {snapshots.length === 0 ? (
          <EmptyState
            title="No closed periods"
            hint={
              <>
                Add a reported period.{' '}
                <Link href={`/grants/${id}/periods/reported`}>Record one →</Link>
              </>
            }
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
              {snapshots.map((s) => {
                const reported = s.source === 'reported';
                return (
                  <tr
                    key={s.lockId}
                    data-testid="period-snapshot"
                    data-source={s.source}
                    className={reported ? 'locked-values' : undefined}
                  >
                    <Td>
                      {s.name}
                      <span className="muted block text-xs">
                        <Period from={s.periodFrom} to={s.periodTo} />
                      </span>
                    </Td>
                    <Td>
                      {reported ? (
                        <StatusPill tone="info" icon="🔒">
                          Reported
                        </StatusPill>
                      ) : (
                        <StatusPill tone="muted">computed at lock</StatusPill>
                      )}
                      <span className="muted block text-xs">
                        {s.actor} · <DateText date={s.createdAt} />
                      </span>
                    </Td>
                    <NumTd cents={s.receivedCents} zero="zero" data-testid="snapshot-received" />
                    {RELEASE_CLASSES.map((c) => (
                      <NumTd
                        key={c}
                        cents={s.released[c]}
                        zero="zero"
                        data-testid={`snapshot-${c}`}
                      />
                    ))}
                    <NumTd
                      cents={s.released.direct + s.released.staff + s.released.overhead}
                      zero="zero"
                      data-testid="snapshot-released"
                    />
                    <Td className="max-w-xs text-sm">
                      {reported ? (
                        <form
                          action={updateReportedNoteAction.bind(null, id)}
                          className="flex items-end gap-2"
                          data-testid="note-form"
                        >
                          <input type="hidden" name="lockId" value={s.lockId} />
                          <label className="relative flex-1">
                            <span className="sr-only">Note for {s.name}</span>
                            <input
                              type="text"
                              name="note"
                              defaultValue={s.note ?? ''}
                              placeholder="Add context"
                              maxLength={500}
                            />
                          </label>
                          <Button size="sm" variant="secondary">
                            Save
                          </Button>
                        </form>
                      ) : (
                        (s.note ?? <span className="muted">—</span>)
                      )}
                    </Td>
                  </tr>
                );
              })}
            </tbody>
          </DataTable>
        )}
        <p className="muted mt-2 text-xs">
          Closed periods are never recomputed. A recompute changes today&apos;s books, not these
          figures. A reported period&apos;s figures are locked (🔒); only its note can change.
          Re-recording a period supersedes its earlier rows and keeps them for audit.
        </p>
      </Card>

      {drift.length > 0 && (
        <Card title="Drift: today's books vs. the period as closed">
          <p className="muted mb-2 text-sm" data-testid="drift-explainer">
            Informational: books vs. what was reported. Not an error.
          </p>
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
                  <NumTd cents={d.reportedCents} zero="zero" data-testid="drift-reported" />
                  {d.booksCents === null ? (
                    <Td className="num" colSpan={2} data-testid="drift-not-computed">
                      <span className="not-computed">Not computed</span>
                      <FootnoteMark id="fn-not-computed" />
                    </Td>
                  ) : (
                    <>
                      <NumTd cents={d.booksCents} zero="zero" data-testid="drift-books" />
                      <NumTd
                        cents={d.driftCents ?? 0}
                        zero="zero"
                        className="drift-neutral"
                        data-testid="drift-diff"
                      />
                    </>
                  )}
                  <Td className="text-sm">
                    {d.driftCents === null ? (
                      <span className="muted">—</span>
                    ) : d.driftCents === 0 ? (
                      <span className="muted">ties</span>
                    ) : (
                      <span className="muted">
                        Books differ by <Money cents={Math.abs(d.driftCents)} />; the closed figure
                        stands.
                      </span>
                    )}
                  </Td>
                </tr>
              ))}
            </tbody>
          </DataTable>
          {hasNotComputed && (
            <Footnote id="fn-not-computed">
              effort charges carry no transaction date, so staff cost cannot be split by period.
              The reported staff figure stands on its own.
            </Footnote>
          )}
        </Card>
      )}
    </>
  );
}
