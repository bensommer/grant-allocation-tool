import { Fragment } from 'react';
import Link from 'next/link';
import {
  Banner,
  ButtonLink,
  Card,
  DataTable,
  EmptyState,
  FilterBar,
  Footnote,
  FootnoteMark,
  Money,
  NumTd,
  PageHeader,
  Th,
  TotalRow,
} from '@/components/ui';
import { Field } from '@/components/form';
import { toISODate } from '@/domain/dates';
import { RELEASE_CLASSES, RELEASE_CLASS_LABEL } from '@/domain/periods';
import { getOrgId } from '@/lib/org';
import { rollforward, type RollforwardRow } from '@/services/grant-periods';
import { rollforwardNotes } from '@/services/grant-workspace';
import { RANGE_PRESET_LABEL, RANGE_PRESETS, resolveRange } from './range';

export const dynamic = 'force-dynamic';

const checkOf = (r: RollforwardRow) =>
  r.beginningCents +
  r.receivedCents -
  (r.released.direct + r.released.staff + r.released.overhead) -
  r.endingCents;

/**
 * Restricted funds rollforward: one column per fund, totals, and a check row.
 * Range presets and the custom from/to are plain GET parameters, so the URL is the
 * report. Decision notes behind a fund's released figure appear as numbered
 * footnotes on the cell, with the note under the table.
 */
export default async function RollforwardPage({
  searchParams,
}: {
  searchParams: Promise<{ range?: string; from?: string; to?: string }>;
}) {
  const sp = await searchParams;
  const orgId = await getOrgId();
  const { from, to, preset, error, fallback } = await resolveRange(orgId, sp);
  const rf = error ? null : await rollforward(orgId, from, to);
  const notes = rf
    ? await Promise.all(
        rf.rows.map(async (r) => ({ grant: r, notes: await rollforwardNotes(orgId, r.grantId) })),
      )
    : [];
  // Footnote numbers run across funds in column order.
  let n = 0;
  const numbered = notes.map(({ grant, notes: ns }) => ({
    grant,
    notes: ns.map((note) => ({ ...note, mark: String(++n) })),
  }));
  const marksFor = (grantId: string) =>
    numbered.find((x) => x.grant.grantId === grantId)?.notes ?? [];
  const query =
    preset === 'custom' ? `from=${toISODate(from)}&to=${toISODate(to)}` : `range=${preset}`;
  return (
    <>
      <PageHeader
        title="Restricted grants rollforward"
        subtitle="Beginning balance, received, released by class, ending — per fund, with a check row."
        secondaryActions={
          rf && (
            <>
              <ButtonLink href={`/grants/rollforward/pdf?${query}`} variant="secondary">
                PDF
              </ButtonLink>
              <ButtonLink href={`/grants/rollforward/xlsx?${query}`} variant="secondary">
                XLSX (formulas)
              </ButtonLink>
            </>
          )
        }
      />
      <nav className="mb-3 flex flex-wrap gap-2 text-sm" aria-label="Range" data-testid="rf-presets">
        {RANGE_PRESETS.filter((p) => p !== 'custom').map((p) => (
          <Link
            key={p}
            href={`/grants/rollforward?range=${p}`}
            aria-current={preset === p ? 'page' : undefined}
            className={`rounded-full border px-3 py-1 hover:no-underline ${
              preset === p ? 'border-harbor bg-harbor-soft font-semibold text-ink' : 'border-line text-ink-soft'
            }`}
            data-preset={p}
          >
            {RANGE_PRESET_LABEL[p]}
          </Link>
        ))}
        <span
          aria-current={preset === 'custom' ? 'page' : undefined}
          className={`rounded-full border px-3 py-1 ${
            preset === 'custom' ? 'border-harbor bg-harbor-soft font-semibold text-ink' : 'border-line text-ink-soft'
          }`}
        >
          {RANGE_PRESET_LABEL.custom}
        </span>
      </nav>
      <FilterBar action="/grants/rollforward">
        <Field label="From" name="from" error={error ?? undefined}>
          <input id="from" name="from" type="date" defaultValue={toISODate(from)} />
        </Field>
        <Field label="To" name="to">
          <input id="to" name="to" type="date" defaultValue={toISODate(to)} />
        </Field>
      </FilterBar>
      {fallback && <Banner tone="info">{fallback}</Banner>}
      {!rf ? null : rf.rows.length === 0 ? (
        <EmptyState title="No restricted funds in this period" />
      ) : (
        <Card
          title="Rollforward"
          action={
            <span className="muted text-sm">
              {RANGE_PRESET_LABEL[preset]} · {toISODate(from)} → {toISODate(to)}
            </span>
          }
        >
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
                  <NumTd key={r.grantId} cents={r.beginningCents} zero="zero" dollar />
                ))}
                <NumTd cents={rf.totals.beginningCents} zero="zero" dollar />
              </tr>
              <tr data-testid="rf-received">
                <Th scope="row">Received</Th>
                {rf.rows.map((r) => (
                  <NumTd key={r.grantId} cents={r.receivedCents} zero="zero" />
                ))}
                <NumTd cents={rf.totals.receivedCents} zero="zero" />
              </tr>
              {RELEASE_CLASSES.map((cls) => (
                <tr key={cls} data-testid={`rf-${cls}`}>
                  <Th scope="row">Released — {RELEASE_CLASS_LABEL[cls].toLowerCase()}</Th>
                  {rf.rows.map((r) => (
                    <NumTd key={r.grantId}>
                      <Money cents={r.released[cls]} zero="zero" />
                      {cls === 'direct' &&
                        marksFor(r.grantId).map((m) => (
                          <FootnoteMark key={m.mark} id={`rf-fn-${m.mark}`} mark={m.mark} />
                        ))}
                    </NumTd>
                  ))}
                  <NumTd cents={rf.totals.released[cls]} zero="zero" />
                </tr>
              ))}
              <TotalRow data-testid="rf-ending">
                <Th scope="row">Ending restricted balance</Th>
                {rf.rows.map((r) => (
                  <NumTd key={r.grantId} cents={r.endingCents} zero="zero" dollar />
                ))}
                <NumTd cents={rf.totals.endingCents} zero="zero" dollar />
              </TotalRow>
              <tr data-testid="rf-check">
                <Th scope="row" className="check-ok">
                  Check
                </Th>
                {rf.rows.map((r) => (
                  <CheckCell key={r.grantId} cents={checkOf(r)} />
                ))}
                <CheckCell cents={rf.totals.checkCents} testId="rf-check-total" />
              </tr>
            </tbody>
          </DataTable>
          <p className="muted mt-2 text-xs">
            Beginning = received − released over all earlier periods (reported snapshots where they
            exist, computed ones otherwise). Released this period = released to date − released in
            earlier periods. Effort charges carry no date and count in the current period.
          </p>
          {numbered.some((x) => x.notes.length > 0 || x.grant.priorPeriods.length > 0) && (
            <div className="mt-3 text-sm" data-testid="rf-notes">
              {numbered.map(({ grant, notes: ns }) => (
                <Fragment key={grant.grantId}>
                  {ns.map((note) => (
                    <Footnote key={note.mark} id={`rf-fn-${note.mark}`} mark={note.mark}>
                      <span data-testid="rf-note">
                        <strong>{grant.name}:</strong> {note.text} <Link href={note.href}>Open →</Link>
                      </span>
                    </Footnote>
                  ))}
                  {grant.priorPeriods.length > 0 && (
                    <p className="muted mt-1 text-xs">
                      <strong>{grant.name}:</strong> beginning balance from{' '}
                      {grant.priorPeriods
                        .map((p) => `${p.name} (${p.source === 'reported' ? 'reported' : 'computed at lock'})`)
                        .join(', ')}
                      . <Link href={`/grants/${grant.grantId}/periods`}>Periods →</Link>
                    </p>
                  )}
                </Fragment>
              ))}
            </div>
          )}
        </Card>
      )}
    </>
  );
}

/** Ties: a muted "0.00 ✓". Anything else is an error and stays red. */
function CheckCell({ cents, testId }: { cents: number; testId?: string }) {
  const ok = cents === 0;
  return (
    <NumTd className={ok ? 'check-ok' : 'text-bad'} data-testid={testId}>
      <Money cents={cents} zero="zero" />
      {ok && <span aria-label="ties"> ✓</span>}
    </NumTd>
  );
}
