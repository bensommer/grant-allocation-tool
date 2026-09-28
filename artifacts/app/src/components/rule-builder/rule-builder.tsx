'use client';
/**
 * The one rule builder (JPH-26 B2) for crosswalk rules and grant rules.
 *
 * Why this is the app's single client island: the ticket wants the sentence and the match count
 * to update as the CPA builds the rule, and the count needs a server round-trip (B3). Everything
 * else stays a plain HTML form — every condition is a real `<input name=…>` in the same order
 * with or without JS, so `new FormData(form)` (the island's preview body) and the browser's
 * native submission are the same bytes, and the server actions parse both with one reader.
 * The component is server-rendered first; before hydration it works as a static form: the
 * "Add condition" menu is a `<details>` holding the extra rows, "Rule decides" and "Show all
 * accounts" are driven by CSS `:has()`, and the Preview button bounces the form state back.
 */
import { useEffect, useId, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { TERMS } from '@/copy/terms';
import type { FormState } from '@/lib/forms';
import {
  CONDITION_GROUPS,
  type ConditionGroup,
  type RuleDimension,
  type RuleFormValues,
  type RuleKind,
} from '@/lib/rule-form';
import { describeValues } from './describe';
import { PreviewPanel } from './preview-panel';
import type { BuilderOption, BuilderOptions, RulePreviewData } from './types';

export const PRIORITY_COPY =
  'When two rules match the same transaction, the lower number wins. New rules default to 50; seed rules use 10.';
const DEBOUNCE_MS = 300;

export interface RuleBuilderProps {
  kind: RuleKind;
  /** Grant name for grant rules (the sentence's scope). */
  grantName?: string;
  action: (formData: FormData) => Promise<void>;
  values: RuleFormValues;
  state: FormState | null;
  saved?: boolean;
  options: BuilderOptions;
  /** Server-rendered preview (after the Preview button, on prefilled or edit pages). */
  preview: RulePreviewData | null;
  /** POST endpoint for the live preview; the island sends the form as FormData. */
  previewUrl: string;
  isNew: boolean;
  /** Where Save returns to (JPH-27 "Always do this" comes from the review queue). */
  returnTo?: string;
}

const GROUP_LABELS: Record<ConditionGroup, string> = {
  programIds: 'Program',
  accountIds: 'Account',
  partyIds: TERMS.name,
  classIds: 'Class',
  locationIds: 'Location',
  descriptionContains: 'Description contains all of',
  descriptionContainsAny: 'Description contains any of',
  txnTypes: 'Transaction type',
  dateRange: 'Date range',
  amountSign: 'Amount sign',
  accountRange: 'Account range',
};

const DEFAULT_ROWS: ConditionGroup[] = ['accountIds', 'partyIds'];

function groupHasValue(v: RuleFormValues, g: ConditionGroup): boolean {
  switch (g) {
    case 'dateRange':
      return !!(v.dateFrom || v.dateTo);
    case 'accountRange':
      return !!(v.accountFrom || v.accountTo);
    case 'descriptionContains':
    case 'descriptionContainsAny':
    case 'amountSign':
      return v[g] !== '';
    default:
      return v[g].length > 0;
  }
}

function clearGroup(v: RuleFormValues, g: ConditionGroup): RuleFormValues {
  switch (g) {
    case 'dateRange':
      return { ...v, dateFrom: '', dateTo: '' };
    case 'accountRange':
      return { ...v, accountFrom: '', accountTo: '' };
    case 'descriptionContains':
    case 'descriptionContainsAny':
    case 'amountSign':
      return { ...v, [g]: '' };
    default:
      return { ...v, [g]: [] };
  }
}

export function RuleBuilder(props: RuleBuilderProps) {
  const { kind, options, state, saved, isNew, previewUrl } = props;
  const uid = useId();
  const formRef = useRef<HTMLFormElement>(null);
  const [values, setValues] = useState<RuleFormValues>(props.values);
  const [nameTouched, setNameTouched] = useState(props.values.name !== '');
  const [rows, setRows] = useState<ConditionGroup[]>(() =>
    CONDITION_GROUPS.filter((g) => DEFAULT_ROWS.includes(g) || groupHasValue(props.values, g)),
  );
  const [preview, setPreview] = useState<RulePreviewData | null>(props.preview);
  const [pending, setPending] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [showAllAccounts, setShowAllAccounts] = useState(() =>
    props.values.accountIds.some((id) => options.accounts.find((a) => a.id === id && !a.expense)),
  );

  // false on the server and during hydration, true afterwards — no effect, no extra render.
  const hydrated = useSyncExternalStore(
    subscribeNever,
    () => true,
    () => false,
  );

  const described = useMemo(
    () => describeValues(values, kind, options, props.grantName),
    [values, kind, options, props.grantName],
  );
  const nameValue = nameTouched ? values.name : described.suggestedName;

  // B3: debounced live preview against POST /api/rules/preview, sending the form exactly as it
  // would be submitted. Skipped until hydration so the server-rendered panel stands on its own.
  const previewKey = JSON.stringify({ ...values, name: '' });
  useEffect(() => {
    if (!hydrated || !formRef.current) return;
    const form = formRef.current;
    const ctrl = new AbortController();
    const t = setTimeout(async () => {
      setPending(true);
      try {
        const res = await fetch(previewUrl, {
          method: 'POST',
          body: new FormData(form),
          signal: ctrl.signal,
        });
        if (!res.ok) throw new Error(`Preview failed (${res.status})`);
        setPreview((await res.json()) as RulePreviewData);
        setPreviewError(null);
      } catch (e) {
        if ((e as Error).name !== 'AbortError') setPreviewError((e as Error).message);
      } finally {
        if (!ctrl.signal.aborted) setPending(false);
      }
    }, DEBOUNCE_MS);
    return () => {
      clearTimeout(t);
      ctrl.abort();
    };
  }, [previewKey, hydrated, previewUrl]);

  const set = <K extends keyof RuleFormValues>(k: K, v: RuleFormValues[K]) =>
    setValues((s) => ({ ...s, [k]: v }));
  const toggle = (k: (typeof LIST_KEYS)[number], id: string, on: boolean) =>
    setValues((s) => ({
      ...s,
      [k]: on ? [...new Set([...s[k], id])] : s[k].filter((x) => x !== id),
    }));

  const available = CONDITION_GROUPS.filter(
    (g) => !rows.includes(g) && (g !== 'programIds' || kind === 'crosswalk'),
  );
  const err = (k: string) => state?.errors[k];
  const onRemoveRow = (g: ConditionGroup) => {
    setRows((r) => r.filter((x) => x !== g));
    setValues((v) => clearGroup(v, g));
  };

  const listRow = (
    g: (typeof LIST_KEYS)[number],
    opts: BuilderOption[],
    extra?: React.ReactNode,
  ) => (
    <ChipSelect
      key={g}
      id={`${uid}-${g}`}
      name={g}
      hydrated={hydrated}
      options={opts}
      selected={values[g]}
      onToggle={(id, on) => toggle(g, id, on)}
      dimIds={
        g === 'accountIds'
          ? new Set(options.accounts.filter((a) => !a.expense).map((a) => a.id))
          : undefined
      }
      extra={extra}
    />
  );

  const rowBody = (g: ConditionGroup): React.ReactNode => {
    switch (g) {
      case 'programIds':
        return listRow(g, options.programs);
      case 'accountIds':
        return listRow(
          g,
          options.accounts,
          <label className="show-all inline-flex items-center gap-1 text-xs font-normal normal-case">
            <input
              type="checkbox"
              checked={showAllAccounts}
              onChange={(e) => setShowAllAccounts(e.target.checked)}
              data-testid="show-all-accounts"
            />
            Show all accounts
          </label>,
        );
      case 'partyIds':
        return listRow(g, options.parties);
      case 'classIds':
        return listRow(g, options.classes);
      case 'locationIds':
        return listRow(g, options.locations);
      case 'txnTypes':
        return listRow(
          g,
          options.txnTypes.map((t) => ({ id: t, label: t })),
        );
      case 'descriptionContains':
        return (
          <input
            id={`${uid}-dc`}
            name="descriptionContains"
            value={values.descriptionContains}
            onChange={(e) => set('descriptionContains', e.target.value)}
            placeholder="every word must appear"
          />
        );
      case 'descriptionContainsAny':
        return (
          <input
            id={`${uid}-dca`}
            name="descriptionContainsAny"
            value={values.descriptionContainsAny}
            onChange={(e) => set('descriptionContainsAny', e.target.value)}
            placeholder="comma separated"
          />
        );
      case 'amountSign':
        return (
          <select
            id={`${uid}-as`}
            name="amountSign"
            value={values.amountSign}
            onChange={(e) => set('amountSign', e.target.value)}
          >
            <option value="">any</option>
            <option value="positive">positive only</option>
            <option value="negative">negative only (credits)</option>
          </select>
        );
      case 'dateRange':
        return (
          <div className="flex flex-wrap items-center gap-2">
            <label className="text-xs" htmlFor={`${uid}-df`}>
              from
            </label>
            <input
              id={`${uid}-df`}
              type="date"
              name="dateFrom"
              value={values.dateFrom}
              onChange={(e) => set('dateFrom', e.target.value)}
            />
            <label className="text-xs" htmlFor={`${uid}-dt`}>
              to
            </label>
            <input
              id={`${uid}-dt`}
              type="date"
              name="dateTo"
              value={values.dateTo}
              onChange={(e) => set('dateTo', e.target.value)}
            />
            {err('matchers.dateTo') ? (
              <p className="field-error">{err('matchers.dateTo')}</p>
            ) : null}
          </div>
        );
      case 'accountRange':
        return (
          <div className="flex flex-wrap items-center gap-2">
            <label className="text-xs" htmlFor={`${uid}-af`}>
              numbers from
            </label>
            <input
              id={`${uid}-af`}
              name="accountFrom"
              value={values.accountFrom}
              onChange={(e) => set('accountFrom', e.target.value)}
              className="w-28"
            />
            <label className="text-xs" htmlFor={`${uid}-at`}>
              to
            </label>
            <input
              id={`${uid}-at`}
              name="accountTo"
              value={values.accountTo}
              onChange={(e) => set('accountTo', e.target.value)}
              className="w-28"
            />
            {err('accountRange') ? <p className="field-error">{err('accountRange')}</p> : null}
          </div>
        );
    }
  };

  const conditionRow = (g: ConditionGroup, i: number, removable: boolean) => (
    <div key={g} className="rule-row" data-group={g}>
      {i > 0 ? (
        <p className="rule-and" aria-hidden="true">
          AND
        </p>
      ) : null}
      <div className="rule-row-head">
        <span className="rule-row-label">{GROUP_LABELS[g]}</span>
        {removable && hydrated ? (
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={() => onRemoveRow(g)}
            aria-label={`Remove ${GROUP_LABELS[g]} condition`}
          >
            Remove
          </button>
        ) : null}
      </div>
      {rowBody(g)}
      {err(`matchers.${g}`) ? <p className="field-error">{err(`matchers.${g}`)}</p> : null}
    </div>
  );

  const targetError =
    err('grantBudgetLineId') ??
    err('targetActivityId') ??
    err('targetCategoryKey') ??
    err('dimension');

  return (
    <form
      ref={formRef}
      action={props.action}
      className="rule-builder"
      data-kind={kind}
      data-hydrated={hydrated ? 'true' : undefined}
      data-testid={kind === 'grant' ? 'grant-rule-form' : 'crosswalk-rule-form'}
    >
      {props.returnTo ? <input type="hidden" name="returnTo" value={props.returnTo} /> : null}
      {state && Object.keys(state.errors).length > 0 ? (
        <div className="banner banner-bad" role="alert">
          {state.errors['_'] ?? 'Please fix the highlighted fields.'}
        </div>
      ) : saved ? (
        <div className="banner banner-ok">Saved.</div>
      ) : null}
      <div className="rule-builder-grid">
        <div className="rule-builder-main card">
          <fieldset className="rule-target" data-dimension={values.dimension}>
            <legend>This rule sends matching {TERMS.transactionsLower} to:</legend>
            {kind === 'grant' ? (
              <div className="rule-decides" role="radiogroup" aria-label="Rule decides">
                <span className="rule-row-label">Rule decides</span>
                {(['line', 'activity', 'category'] as RuleDimension[]).map((d) => (
                  <label key={d} className="rule-segment">
                    <input
                      type="radio"
                      name="dimension"
                      value={d}
                      checked={values.dimension === d}
                      onChange={() => set('dimension', d)}
                    />
                    <span>
                      {d === 'line' ? 'Working line' : d === 'activity' ? 'Activity' : 'Category'}
                    </span>
                  </label>
                ))}
              </div>
            ) : null}
            {kind === 'crosswalk' ? (
              <select
                id={`${uid}-target`}
                name="grantBudgetLineId"
                required
                aria-label="Grant › budget line"
                value={values.grantBudgetLineId}
                onChange={(e) => set('grantBudgetLineId', e.target.value)}
              >
                <option value="">Choose a grant › budget line</option>
                {(options.grants ?? []).map((g) => (
                  <optgroup key={g.id} label={g.name}>
                    {g.lines.map((l) => (
                      <option key={l.id} value={l.id}>
                        {l.label}
                      </option>
                    ))}
                  </optgroup>
                ))}
              </select>
            ) : (
              <>
                <select
                  className="rule-target-select"
                  data-for="line"
                  name="grantBudgetLineId"
                  aria-label="Working line"
                  value={values.grantBudgetLineId}
                  onChange={(e) => set('grantBudgetLineId', e.target.value)}
                >
                  <option value="">Choose a working line</option>
                  {(options.lines ?? []).map((l) => (
                    <option key={l.id} value={l.id}>
                      {l.label}
                    </option>
                  ))}
                </select>
                <select
                  className="rule-target-select"
                  data-for="activity"
                  name="targetActivityId"
                  aria-label="Activity"
                  value={values.targetActivityId}
                  onChange={(e) => set('targetActivityId', e.target.value)}
                >
                  <option value="">Choose an activity</option>
                  {(options.activities ?? []).map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.label}
                    </option>
                  ))}
                </select>
                <select
                  className="rule-target-select"
                  data-for="category"
                  name="targetCategoryKey"
                  aria-label="Category"
                  value={values.targetCategoryKey}
                  onChange={(e) => set('targetCategoryKey', e.target.value)}
                >
                  <option value="">Choose a category</option>
                  {(options.categories ?? []).map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.label} ({c.id})
                    </option>
                  ))}
                </select>
              </>
            )}
            {targetError ? <p className="field-error">{targetError}</p> : null}
          </fieldset>

          <fieldset className="rule-conditions">
            <legend>…when the {TERMS.transaction} matches every condition:</legend>
            {err('matchers') ? <p className="field-error">{err('matchers')}</p> : null}
            {rows.map((g, i) => conditionRow(g, i, !DEFAULT_ROWS.includes(g) || rows.length > 1))}
            {available.length > 0 ? (
              <details className="rule-add" data-testid="add-condition">
                <summary className="btn btn-secondary btn-sm">Add condition</summary>
                {hydrated ? (
                  <ul className="rule-add-menu" role="menu">
                    {available.map((g) => (
                      <li key={g} role="none">
                        <button
                          type="button"
                          role="menuitem"
                          onClick={(e) => {
                            setRows((r) =>
                              CONDITION_GROUPS.filter((x) => r.includes(x) || x === g),
                            );
                            (
                              e.currentTarget.closest('details') as HTMLDetailsElement | null
                            )?.removeAttribute('open');
                          }}
                        >
                          {GROUP_LABELS[g]}
                        </button>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <div className="rule-add-static">
                    <p className="muted text-xs">Fill in any of these; empty ones are ignored.</p>
                    {available.map((g, i) => conditionRow(g, rows.length + i, false))}
                  </div>
                )}
              </details>
            ) : null}
          </fieldset>

          <div className="grid-form mt-4">
            <div>
              <label htmlFor={`${uid}-name`}>Name</label>
              <input
                id={`${uid}-name`}
                name="name"
                maxLength={80}
                value={nameValue}
                placeholder="Filled in from the sentence"
                onChange={(e) => {
                  setNameTouched(true);
                  set('name', e.target.value);
                }}
              />
              {err('name') ? <p className="field-error">{err('name')}</p> : null}
            </div>
            <div>
              <label className="inline-flex items-center gap-2">
                <input
                  type="checkbox"
                  name="active"
                  checked={values.active}
                  onChange={(e) => set('active', e.target.checked)}
                />
                Active
              </label>
            </div>
          </div>

          <details className="rule-advanced mt-4" data-testid="advanced">
            <summary>Advanced</summary>
            <div className="grid-form mt-2">
              <div>
                <label htmlFor={`${uid}-priority`}>Priority</label>
                <input
                  id={`${uid}-priority`}
                  name="priority"
                  type="number"
                  min="0"
                  step="1"
                  value={values.priority}
                  onChange={(e) => set('priority', e.target.value)}
                />
                <p className="muted mt-0.5 text-xs">{PRIORITY_COPY}</p>
                {err('priority') ? <p className="field-error">{err('priority')}</p> : null}
              </div>
            </div>
          </details>
        </div>

        <div className="rule-builder-side">
          <PreviewPanel preview={preview} pending={pending} error={previewError} />
        </div>
      </div>

      <div className="save-bar rule-footer">
        <p className="rule-sentence" data-testid="rule-sentence">
          {described.sentence}
        </p>
        {preview ? (
          <p className="rule-footer-count muted text-sm" data-testid="rule-match-count">
            {preview.count} {preview.count === 1 ? TERMS.transaction : TERMS.transactionsLower}
          </p>
        ) : null}
        <button
          type="submit"
          name="intent"
          value="preview"
          formNoValidate
          className="btn btn-secondary"
        >
          Preview
        </button>
        <button type="submit" className="btn">
          {isNew ? 'Create rule' : 'Save changes'}
        </button>
      </div>
    </form>
  );
}

const subscribeNever = () => () => {};

const LIST_KEYS = [
  'programIds',
  'accountIds',
  'partyIds',
  'classIds',
  'locationIds',
  'txnTypes',
] as const;

/**
 * Searchable multi-select of chips over a plain checkbox list. The checkboxes are the source of
 * truth (and the only thing the server sees); chips and the search box appear after hydration.
 */
function ChipSelect({
  id,
  name,
  options,
  selected,
  hydrated,
  dimIds,
  onToggle,
  extra,
}: {
  id: string;
  name: string;
  options: BuilderOption[];
  selected: string[];
  hydrated: boolean;
  /** Options listed only behind "Show all accounts" (CSS-driven so it works before hydration). */
  dimIds?: Set<string>;
  onToggle: (id: string, on: boolean) => void;
  extra?: React.ReactNode;
}) {
  const [q, setQ] = useState('');
  const needle = q.trim().toLowerCase();
  const byId = new Map(options.map((o) => [o.id, o]));
  // Searching only hides options: every checkbox stays in the DOM (hidden controls still submit
  // and still appear in new FormData(form)), so a selection made before the search — or one that
  // does not match the current search — is never dropped from the preview or the saved rule.
  const shows = (o: BuilderOption) =>
    needle === '' || selected.includes(o.id) || o.label.toLowerCase().includes(needle);
  const visibleCount = options.filter(shows).length;
  return (
    <div className="chip-select">
      {hydrated ? (
        <div className="chip-row">
          {selected.map((s) => (
            <span key={s} className="chip" data-testid="chip">
              <span>{byId.get(s)?.label ?? s}</span>
              {/* "Remove" alone: the chip text is the context; a label that repeats the option
                  name would collide with the checkbox's label for assistive tech. */}
              <button type="button" aria-label="Remove" onClick={() => onToggle(s, false)}>
                ×
              </button>
            </span>
          ))}
          <input
            id={`${id}-search`}
            type="search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={selected.length ? 'Search…' : 'Search and tick to add'}
            aria-label={`Search ${name}`}
            className="chip-search"
          />
        </div>
      ) : null}
      {extra}
      <div className="chip-options">
        {visibleCount === 0 ? <p className="muted text-xs">No matches.</p> : null}
        {options.map((o) => (
          <label
            key={o.id}
            className="chip-option"
            data-dim={dimIds?.has(o.id) ? '' : undefined}
            hidden={!shows(o)}
          >
            <input
              type="checkbox"
              name={name}
              value={o.id}
              checked={selected.includes(o.id)}
              onChange={(e) => onToggle(o.id, e.target.checked)}
            />
            <span>{o.label}</span>
          </label>
        ))}
      </div>
    </div>
  );
}
