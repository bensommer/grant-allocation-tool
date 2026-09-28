import {
  Button,
  Card,
  DataTable,
  DateText,
  EmptyState,
  NumTd,
  Td,
  Th,
  TotalRow,
} from '@/components/ui';
import { Field } from '@/components/form';
import { parseDateInput, toISODate } from '@/domain/dates';
import type { PlannedEntry } from '@/domain/periods';
import type { BudgetTree } from '@/services/grant-budget';
import { forecast } from '@/services/grant-workspace';

/** Blank planned-entry rows shown at first; "Add row" re-renders with one more. */
const MIN_SLOTS = 3;
const MAX_SLOTS = 12;

/**
 * Forecast strip (Internal view): a stateless GET form so the URL carries the plan. Moved here
 * from the old `/working` page unchanged (JPH-29 E2).
 */
export function ForecastStrip({
  id,
  tree,
  grant,
  sp,
}: {
  id: string;
  tree: BudgetTree;
  grant: { endDate: Date };
  sp: Record<string, string | undefined>;
}) {
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
    <Card title="Forecast strip">
      <form
        method="get"
        action={`/grants/${id}/bva`}
        className="grid gap-3 md:grid-cols-[1fr_auto]"
        data-testid="forecast-form"
      >
        <input type="hidden" name="view" value="internal" />
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
            <input id="to" type="date" name="to" defaultValue={sp.to ?? toISODate(grant.endDate)} />
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
  );
}
