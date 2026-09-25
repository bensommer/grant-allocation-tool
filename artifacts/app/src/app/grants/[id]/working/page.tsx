import { notFound } from 'next/navigation';
import {
  Button,
  Card,
  DataTable,
  DateText,
  EmptyState,
  NumTd,
  PageHeader,
  Period,
  Td,
  Th,
  TotalRow,
} from '@/components/ui';
import { Field } from '@/components/form';
import { PacingCallout } from '@/components/pacing-callout';
import { parseDateInput, toISODate } from '@/domain/dates';
import type { PlannedEntry } from '@/domain/periods';
import { getOrgId } from '@/lib/org';
import { defaultReportDate } from '@/services/bva';
import { budgetTree } from '@/services/grant-budget';
import { grantFiguresFor } from '@/services/grant-figures';
import { forecast, grantHeader, workingView, type WorkingRow } from '@/services/grant-workspace';
import { GrantTabs } from '../tabs';

export const dynamic = 'force-dynamic';

/** Blank planned-entry rows shown at first; "Add row" re-renders with one more. */
const MIN_SLOTS = 3;
const MAX_SLOTS = 12;

/** Remaining per month left in the grant, plus a forecast strip for planned entries. */
export default async function WorkingViewPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const { id } = await params;
  const sp = await searchParams;
  const orgId = await getOrgId();
  const grant = await grantHeader(orgId, id);
  if (!grant) notFound();
  const { date } = await defaultReportDate(orgId, sp.asOf);
  const [tree, figures] = await Promise.all([
    budgetTree(orgId, id, date),
    grantFiguresFor(orgId, id, date),
  ]);
  if (!figures) notFound();
  const view = workingView(tree, grant, date);

  // Forecast strip: a stateless GET form so the URL carries the plan.
  let fcTo: Date = grant.endDate;
  let fcError: string | null = null;
  if (sp.to) {
    try {
      fcTo = parseDateInput(sp.to);
    } catch {
      fcError = 'Enter the forecast date as YYYY-MM-DD.';
    }
  }
  // Rows: at least MIN_SLOTS; the highest slot named in the URL plus one when "Add row" asked.
  const named = Object.keys(sp)
    .map((k) => /^(?:count|hours|rate)(\d+)$/.exec(k)?.[1])
    .filter((n): n is string => n !== undefined)
    .map(Number);
  const slotCount = Math.min(
    MAX_SLOTS,
    Math.max(MIN_SLOTS, (named.length ? Math.max(...named) + 1 : 0) + (sp.add ? 1 : 0)),
  );
  const slots = Array.from({ length: slotCount }, (_, i) => i);
  const entries: PlannedEntry[] = slots
    .map((i) => ({
      count: Number(sp[`count${i}`] ?? 0) || 0,
      hours: sp[`hours${i}`] ?? '',
      rate: sp[`rate${i}`] ?? '',
    }))
    .filter((e) => e.count > 0 && e.hours !== '' && e.rate !== '');
  const lineCode = sp.line ?? '';
  const target = tree.all.find((l) => l.code === lineCode && l.kind !== 'funder_category');
  const fc = forecast(
    target ? target.chargedCents : tree.totals.chargedCents,
    target ? target.currentCents : tree.totals.budgetCents,
    fcTo,
    entries,
  );
  const lineOptions = tree.all.filter((l) => l.kind !== 'funder_category');

  return (
    <>
      <PageHeader
        title={grant.name}
        subtitle={
          <>
            {grant.funder} · <Period from={grant.startDate} to={grant.endDate} />
          </>
        }
      />
      <GrantTabs id={id} active="working" />
      <Card title="Pacing">
        <PacingCallout figures={figures.figures} />
      </Card>
      <Card
        title="Working view"
        action={
          <span className="muted text-sm">
            Report date <DateText date={date} />
          </span>
        }
      >
        <DataTable stickyFirstColumn>
          <thead>
            <tr>
              <Th>Line</Th>
              <Th num>Budget ($)</Th>
              <Th num>Charged ($)</Th>
              <Th num>Remaining ($)</Th>
              <Th num>Per month left ($)</Th>
            </tr>
          </thead>
          <tbody>
            {view.categories.map((c) => (
              <CategoryBlock key={c.category.id} block={c} />
            ))}
            {view.loose.map((r) => (
              <Row key={r.line.id} row={r} />
            ))}
            <TotalRow>
              <Th scope="row">Total</Th>
              <NumTd cents={tree.totals.budgetCents} dollar data-testid="total-budget" />
              <NumTd cents={tree.totals.chargedCents} dollar data-testid="total-charged" />
              <NumTd cents={view.totalRemainingCents} dollar data-testid="total-remaining" />
              <PerMonth cents={view.totalPerMonthCents} testId="total-per-month" />
            </TotalRow>
          </tbody>
        </DataTable>
        <p className="muted mt-2 text-xs">
          Months left = days from the report date to the grant end ÷ 30.44, to one decimal. Per
          month = remaining ÷ months left, rounded half-up. Blank once the grant has ended.
        </p>
      </Card>

      <Card title="Forecast strip">
        <form
          method="get"
          className="grid gap-3 md:grid-cols-[1fr_auto]"
          data-testid="forecast-form"
        >
          {sp.asOf && <input type="hidden" name="asOf" value={sp.asOf} />}
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Line" name="line">
              <select id="line" name="line" defaultValue={lineCode}>
                <option value="">Whole grant</option>
                {lineOptions.map((l) => (
                  <option key={l.id} value={l.code}>
                    {l.code} — {l.name}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Project to date" name="to" error={fcError ?? undefined}>
              <input
                id="to"
                type="date"
                name="to"
                defaultValue={sp.to ?? toISODate(grant.endDate)}
              />
            </Field>
            {slots.map((i) => (
              <div key={i} className="grid grid-cols-3 gap-2 sm:col-span-2 sm:grid-cols-6">
                <Field label={`Entry ${i + 1}: count`} name={`count${i}`}>
                  <input
                    id={`count${i}`}
                    type="number"
                    name={`count${i}`}
                    min={0}
                    step={1}
                    defaultValue={sp[`count${i}`] ?? ''}
                  />
                </Field>
                <Field label="Hours each" name={`hours${i}`}>
                  <input
                    id={`hours${i}`}
                    type="number"
                    name={`hours${i}`}
                    min={0}
                    step="0.25"
                    defaultValue={sp[`hours${i}`] ?? ''}
                  />
                </Field>
                <Field label="Rate ($/hour)" name={`rate${i}`}>
                  <input
                    id={`rate${i}`}
                    type="number"
                    name={`rate${i}`}
                    min={0}
                    step="0.01"
                    defaultValue={sp[`rate${i}`] ?? ''}
                  />
                </Field>
              </div>
            ))}
          </div>
          <div className="flex flex-wrap gap-2 self-end">
            <Button type="submit" variant="secondary">
              Project
            </Button>
            {slotCount < MAX_SLOTS && (
              <Button type="submit" name="add" value="1" variant="ghost" data-testid="add-row">
                Add row
              </Button>
            )}
          </div>
        </form>
        {fc.entries.length === 0 ? (
          <div data-testid="forecast">
            <EmptyState
              title="No planned spend"
              hint="Add planned programs to project spend to grant end."
            />
          </div>
        ) : (
          <DataTable>
            <tbody data-testid="forecast">
              <tr>
                <Td>Spent to date{target ? ` on ${target.code}` : ''}</Td>
                <NumTd cents={fc.spentCents} />
              </tr>
              {fc.entries.map((e, i) => (
                <tr key={i}>
                  <Td>
                    Planned: {e.count} × {e.hours} h × ${e.rate}
                  </Td>
                  <NumTd cents={e.cents} data-testid="planned-entry" />
                </tr>
              ))}
              <tr>
                <Td>Planned total</Td>
                <NumTd cents={fc.plannedCents} data-testid="planned-total" />
              </tr>
              <TotalRow>
                <Th scope="row">
                  Projected spend at <DateText date={fc.to} />
                </Th>
                <NumTd cents={fc.projectedCents} dollar data-testid="projected" />
              </TotalRow>
              <tr>
                <Td>Budget remaining after plan</Td>
                <NumTd cents={fc.remainingAfterCents} data-testid="remaining-after" />
              </tr>
            </tbody>
          </DataTable>
        )}
      </Card>
    </>
  );
}

function PerMonth({ cents, testId }: { cents: number | null; testId?: string }) {
  return cents === null ? (
    <Td className="num muted" data-testid={testId} title="grant period has ended">
      —
    </Td>
  ) : (
    <NumTd cents={cents} data-testid={testId} />
  );
}

function Row({ row: r, indent }: { row: WorkingRow; indent?: boolean }) {
  return (
    <tr data-testid="working-line" data-code={r.line.code}>
      <Td className={indent ? 'pl-6' : undefined}>
        {r.line.name}
        <span className="muted block text-xs">{r.line.code}</span>
      </Td>
      <NumTd cents={r.line.currentCents} />
      <NumTd cents={r.line.chargedCents} />
      <NumTd cents={r.remainingCents} data-testid="line-remaining" />
      <PerMonth cents={r.perMonthCents} testId="line-per-month" />
    </tr>
  );
}

function CategoryBlock({
  block: c,
}: {
  block: ReturnType<typeof workingView>['categories'][number];
}) {
  return (
    <>
      <tr className="font-semibold" data-testid="working-category" data-code={c.category.code}>
        <Th scope="row">{c.category.name}</Th>
        <NumTd cents={c.category.currentCents} />
        <NumTd cents={c.category.chargedCents} />
        <NumTd cents={c.remainingCents} data-testid="category-remaining" />
        <PerMonth cents={c.perMonthCents} testId="category-per-month" />
      </tr>
      {c.rows.map((r) => (
        <Row key={r.line.id} row={r} indent />
      ))}
    </>
  );
}
