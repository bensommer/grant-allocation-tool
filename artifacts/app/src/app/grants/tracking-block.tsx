import { CheckboxList, Field } from '@/components/form';
import { TERMS } from '@/copy/terms';
import {
  NAME_PREFIX,
  trackingCountSentence,
  trackingSelection,
  type TrackingFields,
  type TrackingSelection,
} from '@/domain/tracking-choice';
import { type FormState, pick, pickList } from '@/lib/forms';
import type { TrackingOptions } from '@/services/tracking-options';
import { TRACKING_FIELDS } from './tracking-form';

/** The selection the form should show: posted values win over the stored grant. */
export function currentSelection(
  state: FormState | null,
  grant: TrackingFields | null,
): TrackingSelection {
  const stored = trackingSelection(grant);
  if (!state) return stored;
  const choice = pick(state, TRACKING_FIELDS.choice, stored.choice);
  return {
    choice: choice === 'class' || choice === 'project' ? choice : 'neither',
    classValue: pick(state, TRACKING_FIELDS.classValue, stored.classValue) ?? '',
    projectValue: pick(state, TRACKING_FIELDS.projectValue, stored.projectValue) ?? '',
    extraClassIds: pickList(state, TRACKING_FIELDS.extraClassIds, stored.extraClassIds),
    extraPartyIds: pickList(state, TRACKING_FIELDS.extraPartyIds, stored.extraPartyIds),
  };
}

function nameOf(value: string, options: TrackingOptions['classes']): string | null {
  if (value.startsWith(NAME_PREFIX)) return value.slice(NAME_PREFIX.length);
  return options.find((o) => o.id === value)?.name ?? null;
}

function countOf(value: string, options: TrackingOptions['classes']): number | null {
  if (value === '' || value.startsWith(NAME_PREFIX)) return value === '' ? null : 0;
  return options.find((o) => o.id === value)?.count ?? 0;
}

/** Live count for the chosen option; a free-text name outside the books says so instead. */
function CountNote({
  value,
  count,
  kind,
}: {
  value: string;
  count: number | null;
  kind: 'class' | 'project';
}) {
  if (value === '' || count === null) return null;
  const pseudo = value.startsWith(NAME_PREFIX);
  return (
    <span
      className="muted text-xs"
      data-testid="tracking-count"
      data-count={count}
      data-kind={kind}
      data-source={pseudo ? 'import' : 'books'}
    >
      {pseudo
        ? `No imported transaction carries this ${kind === 'class' ? 'class' : 'name'}; the grant's transactions come from its QuickBooks report import.`
        : trackingCountSentence(count, kind)}
    </span>
  );
}

/**
 * "How QuickBooks tracks this grant" (JPH-29 E3): three radios — Class (select), Project /
 * customer (select), Neither — with the live transaction count for the current selection, and
 * the free-text names derived from the choice behind an "Override" disclosure. Server-rendered;
 * `recountName` is the name of a secondary submit button that re-renders the form with the
 * count for a newly chosen option (no JavaScript needed).
 */
export function TrackingBlock({
  state,
  grant,
  options,
  recountName = 'intent',
}: {
  state: FormState | null;
  grant: TrackingFields | null;
  options: TrackingOptions;
  recountName?: string;
}) {
  const sel = currentSelection(state, grant);
  const classOptions = [...options.classes];
  const projectOptions = [...options.parties];
  // A stored free-text name with no matching class / name gets its own option, so the select
  // shows what the grant is coded to and saving keeps the stored ids unchanged.
  if (sel.classValue.startsWith(NAME_PREFIX))
    classOptions.push({
      id: sel.classValue,
      name: sel.classValue.slice(NAME_PREFIX.length),
      count: 0,
    });
  if (sel.projectValue.startsWith(NAME_PREFIX))
    projectOptions.push({
      id: sel.projectValue,
      name: sel.projectValue.slice(NAME_PREFIX.length),
      count: 0,
    });
  const derivedClass = sel.choice === 'class' ? nameOf(sel.classValue, classOptions) : null;
  const derivedProject = sel.choice === 'project' ? nameOf(sel.projectValue, projectOptions) : null;
  const classOverride = pick(
    state,
    TRACKING_FIELDS.classOverride,
    grant?.qboClassName && grant.qboClassName !== derivedClass ? grant.qboClassName : '',
  );
  const projectOverride = pick(
    state,
    TRACKING_FIELDS.projectOverride,
    grant?.qboProjectName && grant.qboProjectName !== derivedProject ? grant.qboProjectName : '',
  );
  const classCount = countOf(sel.classValue, classOptions);
  const projectCount = countOf(sel.projectValue, projectOptions);
  const optionLabel = (
    o: { name: string; count: number; id: string; kind?: string },
    noun: 'class' | 'name',
  ) =>
    o.id.startsWith(NAME_PREFIX)
      ? `${o.name} (not a ${noun} in the imported books)`
      : `${o.name}${o.kind === 'project' ? ' (project)' : ''} — ${o.count.toLocaleString('en-US')} transaction${o.count === 1 ? '' : 's'}`;
  return (
    <fieldset
      id="tracking"
      className="min-w-0 rounded border border-line bg-white p-3 md:col-span-2"
      data-testid="tracking-block"
      data-choice={sel.choice}
    >
      <legend className="px-1 text-sm font-semibold">{TERMS.howQuickBooksTracks}</legend>
      <p className="muted mb-2 text-xs">
        Pick the one thing in QuickBooks that marks a transaction as this grant&apos;s. Every
        transaction carrying it belongs to the grant and shows up in Review, rules and effort.
      </p>
      {state?.errors['tracking'] ? <p className="field-error">{state.errors['tracking']}</p> : null}
      <div className="grid gap-3">
        {/* Class */}
        <div className="grid min-w-0 gap-1 rounded border border-line p-2">
          <label className="flex items-center gap-2 text-sm font-normal normal-case text-ink">
            <input
              type="radio"
              name={TRACKING_FIELDS.choice}
              value="class"
              defaultChecked={sel.choice === 'class'}
              data-testid="tracking-choice-class"
            />
            <span>
              <strong>Class</strong> — every transaction tagged with this class
            </span>
          </label>
          <div className="flex min-w-0 flex-wrap items-center gap-2 pl-6">
            <select
              name={TRACKING_FIELDS.classValue}
              defaultValue={sel.classValue}
              aria-label="Class in the books"
              data-testid="tracking-class"
              className="!w-auto min-w-0 max-w-full"
            >
              <option value="">Choose a class</option>
              {classOptions.map((o) => (
                <option key={o.id} value={o.id}>
                  {optionLabel(o, 'class')}
                </option>
              ))}
            </select>
            {sel.choice === 'class' ? (
              <CountNote value={sel.classValue} count={classCount} kind="class" />
            ) : null}
          </div>
        </div>
        {/* Project / customer */}
        <div className="grid min-w-0 gap-1 rounded border border-line p-2">
          <label className="flex items-center gap-2 text-sm font-normal normal-case text-ink">
            <input
              type="radio"
              name={TRACKING_FIELDS.choice}
              value="project"
              defaultChecked={sel.choice === 'project'}
              data-testid="tracking-choice-project"
            />
            <span>
              <strong>Project / customer</strong> — every transaction tagged with this name
            </span>
          </label>
          <div className="flex min-w-0 flex-wrap items-center gap-2 pl-6">
            <select
              name={TRACKING_FIELDS.projectValue}
              defaultValue={sel.projectValue}
              aria-label="Project or customer in the books"
              data-testid="tracking-project"
              className="!w-auto min-w-0 max-w-full"
            >
              <option value="">Choose a project or customer</option>
              {projectOptions.map((o) => (
                <option key={o.id} value={o.id}>
                  {optionLabel(o, 'name')}
                </option>
              ))}
            </select>
            {sel.choice === 'project' ? (
              <CountNote value={sel.projectValue} count={projectCount} kind="project" />
            ) : null}
          </div>
        </div>
        {/* Neither */}
        <label className="flex items-center gap-2 rounded border border-line p-2 text-sm font-normal normal-case text-ink">
          <input
            type="radio"
            name={TRACKING_FIELDS.choice}
            value="neither"
            defaultChecked={sel.choice === 'neither'}
            data-testid="tracking-choice-neither"
          />
          <span>
            <strong>Neither</strong> — I import a QuickBooks report per grant
          </span>
        </label>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="submit"
            name={recountName}
            value="recount"
            className="btn btn-secondary btn-sm"
            data-testid="tracking-recount"
          >
            Update count
          </button>
          <span className="muted text-xs">
            Shows how many transactions the chosen option marks.
          </span>
        </div>
      </div>
      {sel.extraClassIds.map((id) => (
        <input key={id} type="hidden" name={TRACKING_FIELDS.extraClassIds} value={id} />
      ))}
      {sel.extraPartyIds.map((id) => (
        <input key={id} type="hidden" name={TRACKING_FIELDS.extraPartyIds} value={id} />
      ))}
      {sel.extraClassIds.length + sel.extraPartyIds.length > 0 && (
        <p className="muted mt-2 text-xs" data-testid="tracking-also">
          Also tracked by{' '}
          {[
            ...sel.extraClassIds.map((id) => `class ${nameOf(id, options.classes) ?? id}`),
            ...sel.extraPartyIds.map((id) => `customer ${nameOf(id, options.parties) ?? id}`),
          ].join(', ')}
          . These stay unless you choose Neither.
        </p>
      )}
      <details className="mt-3" data-testid="tracking-override">
        <summary className="cursor-pointer text-sm">Override</summary>
        <p className="muted mb-2 text-xs">
          The names used on the grant side of correcting entries. They follow your choice above;
          type here only if QuickBooks spells them differently.
        </p>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Class name" name={TRACKING_FIELDS.classOverride}>
            <p className="muted text-xs" data-testid="derived-class-name">
              Derived: {derivedClass ?? '—'}
            </p>
            <input
              id={TRACKING_FIELDS.classOverride}
              name={TRACKING_FIELDS.classOverride}
              defaultValue={classOverride}
              placeholder={derivedClass ?? ''}
            />
          </Field>
          <Field label="Project / customer name" name={TRACKING_FIELDS.projectOverride}>
            <p className="muted text-xs" data-testid="derived-project-name">
              Derived: {derivedProject ?? '—'}
            </p>
            <input
              id={TRACKING_FIELDS.projectOverride}
              name={TRACKING_FIELDS.projectOverride}
              defaultValue={projectOverride}
              placeholder={derivedProject ?? ''}
            />
          </Field>
        </div>
      </details>
    </fieldset>
  );
}

/** Separate small block: which income counts as this grant's receipts. */
export function GrantIncomeBlock({
  state,
  grant,
  customers,
  classes,
}: {
  state: FormState | null;
  grant: { matchPartyIds: string[]; matchClassIds: string[] } | null;
  customers: Array<{ id: string; displayName: string }>;
  classes: Array<{ id: string; name: string }>;
}) {
  return (
    <fieldset
      className="min-w-0 rounded border border-line bg-white p-3 md:col-span-2"
      data-testid="grant-income-block"
    >
      <legend className="px-1 text-sm font-semibold">{TERMS.grantIncome}</legend>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field
          label={TERMS.funderCustomerNames}
          name="matchPartyIds"
          hint="Income transactions from these QuickBooks customers count as this grant's receipts."
        >
          <CheckboxList
            name="matchPartyIds"
            options={customers.map((c) => ({ value: c.id, label: c.displayName }))}
            selected={pickList(state, 'matchPartyIds', grant?.matchPartyIds ?? [])}
          />
        </Field>
        <Field
          label={TERMS.incomeClassesShort}
          name="matchClassIds"
          hint="Income transactions tagged with these classes also count as receipts."
        >
          <CheckboxList
            name="matchClassIds"
            options={classes.map((c) => ({ value: c.id, label: c.name }))}
            selected={pickList(state, 'matchClassIds', grant?.matchClassIds ?? [])}
          />
        </Field>
      </div>
    </fieldset>
  );
}
