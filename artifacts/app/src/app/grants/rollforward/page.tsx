import { Fragment } from 'react';
import Link from 'next/link';
import {
  ButtonLink,
  Card,
  DataTable,
  EmptyState,
  FilterBar,
  Money,
  NumTd,
  PageHeader,
  Th,
  TotalRow,
} from '@/components/ui';
import { Field } from '@/components/form';
import { parseDateInput, toISODate } from '@/domain/dates';
import { RELEASE_CLASSES, RELEASE_CLASS_LABEL } from '@/domain/periods';
import { getOrgId } from '@/lib/org';
import { rollforward, type RollforwardRow } from '@/services/grant-periods';
import { rollforwardNotes } from '@/services/grant-workspace';
import { resolveRange } from './range';

export const dynamic = 'force-dynamic';

const checkOf = (r: RollforwardRow) =>
  r.beginningCents +
  r.receivedCents -
  (r.released.direct + r.released.staff + r.released.overhead) -
  r.endingCents;

/** Restricted funds rollforward: one column per fund, totals, and a check row. */
export default async function RollforwardPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; to?: string }>;
}) {
  const sp = await searchParams;
  const orgId = await getOrgId();
  const { from, to, error } = await resolveRange(orgId, sp.from, sp.to);
  const rf = error ? null : await rollforward(orgId, from, to);
  const notes = rf
    ? await Promise.all(
        rf.rows.map(async (r) => ({ grant: r, notes: await rollforwardNotes(orgId, r.grantId) })),
      )
    : [];
  const query = `from=${toISODate(from)}&to=${toISODate(to)}`;
  return (
    <>
      <PageHeader
        title="Restricted grants rollforward"
        subtitle="Beginning balance, received, released by class, ending — per fund, with a check row."
        secondaryActions={
          rf && (
            <ButtonLink href={`/grants/rollforward/xlsx?${query}`} variant="secondary">
              XLSX (formulas)
            </ButtonLink>
          )
        }
      />
      <FilterBar action="/grants/rollforward">
        <Field label="From" name="from" error={error ?? undefined}>
          <input id="from" name="from" type="date" defaultValue={toISODate(from)} />
        </Field>
        <Field label="To" name="to">
          <input id="to" name="to" type="date" defaultValue={toISODate(to)} />
        </Field>
      </FilterBar>
      {!rf ? null : rf.rows.length === 0 ? (
        <EmptyState title="No restricted funds in this period" />
      ) : (
        <Card title="Rollforward" action={<span className="muted text-sm">{toISODate(from)} → {toISODate(to)}</span>}>
          <DataTable stickyFirstColumn>
            <thead>
              <tr>
                <Th>Line</Th>
                {rf.rows.map((r) => (
                  <Th key={r.grantId} num>
                    <Link href={`/grants/${r.grantId}`}>{r.name}</Link>
                  </Th>
                ))}
                <Th num>Total</Th>
              </tr>
            </thead>
            <tbody>
              <tr data-testid="rf-beginning">
                <Th scope="row">Beginning restricted balance</Th>
                {rf.rows.map((r) => (
                  <NumTd key={r.grantId} cents={r.beginningCents} dollar />
                ))}
                <NumTd cents={rf.totals.beginningCents} dollar />
              </tr>
              <tr data-testid="rf-received">
                <Th scope="row">Received</Th>
                {rf.rows.map((r) => (
                  <NumTd key={r.grantId} cents={r.receivedCents} />
                ))}
                <NumTd cents={rf.totals.receivedCents} />
              </tr>
              {RELEASE_CLASSES.map((cls) => (
                <tr key={cls} data-testid={`rf-${cls}`}>
                  <Th scope="row">Released — {RELEASE_CLASS_LABEL[cls].toLowerCase()}</Th>
                  {rf.rows.map((r) => (
                    <NumTd key={r.grantId} cents={r.released[cls]} />
                  ))}
                  <NumTd cents={rf.totals.released[cls]} />
                </tr>
              ))}
              <TotalRow data-testid="rf-ending">
                <Th scope="row">Ending restricted balance</Th>
                {rf.rows.map((r) => (
                  <NumTd key={r.grantId} cents={r.endingCents} dollar />
                ))}
                <NumTd cents={rf.totals.endingCents} dollar />
              </TotalRow>
              <tr data-testid="rf-check">
                <Th scope="row">Check (should be 0.00)</Th>
                {rf.rows.map((r) => (
                  <NumTd key={r.grantId}>
                    <Money cents={checkOf(r)} zero="zero" />
                  </NumTd>
                ))}
                <NumTd
                  className={rf.totals.checkCents ? 'text-bad' : undefined}
                  data-testid="rf-check-total"
                >
                  <Money cents={rf.totals.checkCents} zero="zero" />
                </NumTd>
              </tr>
            </tbody>
          </DataTable>
          <p className="muted mt-2 text-xs">
            Beginning = received − released over all earlier periods (reported snapshots where they
            exist, computed ones otherwise). Released this period = released to date − released in
            earlier periods. Effort charges carry no date and count in the current period.
          </p>
          {notes.some((n) => n.notes.length > 0 || n.grant.priorPeriods.length > 0) && (
            <div className="mt-3 text-sm" data-testid="rf-notes">
              <h3 className="mb-1 font-semibold">Notes</h3>
              <ul className="list-disc space-y-1 pl-5">
                {notes.map(({ grant, notes: ns }) => (
                  <Fragment key={grant.grantId}>
                    {grant.priorPeriods.length > 0 && (
                      <li>
                        <strong>{grant.name}:</strong> beginning balance from{' '}
                        {grant.priorPeriods
                          .map((p) => `${p.name} (${p.source === 'reported' ? 'reported' : 'computed at lock'})`)
                          .join(', ')}
                        . <Link href={`/grants/${grant.grantId}/periods`}>Periods →</Link>
                      </li>
                    )}
                    {ns.map((n, i) => (
                      <li key={i} data-testid="rf-note">
                        <strong>{grant.name}:</strong> {n.text} <Link href={n.href}>Open →</Link>
                      </li>
                    ))}
                  </Fragment>
                ))}
              </ul>
            </div>
          )}
        </Card>
      )}
    </>
  );
}
