import { CheckboxList, Field, FormBanner } from '@/components/form';
import { DataTable, DateText, Money, NumTd, Th } from '@/components/ui';
import { categoryLabel } from '@/domain/categories';
import { parseMatchers, type Matchers } from '@/domain/matchers';
import type { GrantRulePreview } from '@/services/grant-rules';
import { pick, pickBool, pickList, type FormState } from '@/lib/forms';

export interface RuleFormOptions {
  targets: Array<{ id: string; label: string }>;
  activities: Array<{ id: string; name: string }>;
  categoryKeys: string[];
  accounts: Array<{ id: string; label: string }>;
  classes: Array<{ id: string; label: string }>;
  parties: Array<{ id: string; label: string }>;
  txnTypes: string[];
}

export interface PreviewSample {
  id: string;
  txnDate: Date;
  docNumber: string | null;
  account: string;
  party: string | null;
  description: string | null;
  amountCents: number;
}

type Rule = {
  name: string | null;
  dimension: string;
  grantBudgetLineId: string | null;
  targetActivityId: string | null;
  targetCategoryKey: string | null;
  priority: number;
  active: boolean;
  matchers: unknown;
};

export function GrantRuleForm({
  action,
  state,
  rule,
  options,
  preview,
  saved,
}: {
  action: (formData: FormData) => Promise<void>;
  state: FormState | null;
  rule: Rule | null;
  options: RuleFormOptions;
  preview?: { result: GrantRulePreview; sample: PreviewSample[] };
  saved?: boolean;
}) {
  const m: Matchers = rule ? parseMatchers(rule.matchers) : {};
  const lists = [
    {
      name: 'accountIds',
      label: 'Accounts',
      values: options.accounts,
      selected: m.accountIds ?? [],
    },
    { name: 'classIds', label: 'Classes', values: options.classes, selected: m.classIds ?? [] },
    {
      name: 'partyIds',
      label: 'Payees / parties',
      values: options.parties,
      selected: m.partyIds ?? [],
    },
  ];
  return (
    <>
      <form action={action} className="card" data-testid="grant-rule-form">
        <FormBanner state={state} saved={saved} />
        {state?.errors['matchers'] ? (
          <p className="field-error">{state.errors['matchers']}</p>
        ) : null}
        <div className="grid-form">
          <Field name="name" label="Name" error={state?.errors['name']}>
            <input id="name" name="name" required defaultValue={pick(state, 'name', rule?.name)} />
          </Field>
          <Field name="dimension" label="Rule decides" error={state?.errors['dimension']}>
            <select
              id="dimension"
              name="dimension"
              defaultValue={pick(state, 'dimension', rule?.dimension ?? 'line')}
            >
              <option value="line">Working line (assigns the line)</option>
              <option value="activity">Activity (half of a cell)</option>
              <option value="category">Category (other half of a cell)</option>
            </select>
          </Field>
          <Field
            name="grantBudgetLineId"
            label="Target working line / cell (line rules)"
            error={state?.errors['grantBudgetLineId']}
          >
            <select
              id="grantBudgetLineId"
              name="grantBudgetLineId"
              defaultValue={pick(state, 'grantBudgetLineId', rule?.grantBudgetLineId)}
            >
              <option value="">— none —</option>
              {options.targets.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.label}
                </option>
              ))}
            </select>
          </Field>
          <Field
            name="targetActivityId"
            label="Target activity (activity rules)"
            error={state?.errors['targetActivityId']}
          >
            <select
              id="targetActivityId"
              name="targetActivityId"
              defaultValue={pick(state, 'targetActivityId', rule?.targetActivityId)}
            >
              <option value="">— none —</option>
              {options.activities.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </select>
          </Field>
          <Field
            name="targetCategoryKey"
            label="Target category (category rules)"
            error={state?.errors['targetCategoryKey']}
          >
            <select
              id="targetCategoryKey"
              name="targetCategoryKey"
              defaultValue={pick(state, 'targetCategoryKey', rule?.targetCategoryKey)}
            >
              <option value="">— none —</option>
              {options.categoryKeys.map((k) => (
                <option key={k} value={k}>
                  {categoryLabel(k)} ({k})
                </option>
              ))}
            </select>
          </Field>
          <Field name="priority" label="Priority (lowest wins)" error={state?.errors['priority']}>
            <input
              id="priority"
              name="priority"
              type="number"
              min="0"
              step="1"
              defaultValue={pick(state, 'priority', String(rule?.priority ?? 100))}
            />
          </Field>
          <Field name="active" label="Active">
            <input
              id="active"
              name="active"
              type="checkbox"
              defaultChecked={pickBool(state, 'active', rule?.active ?? true)}
            />
          </Field>
          {lists.map((l) => (
            <Field
              key={l.name}
              name={l.name}
              label={l.label}
              className="md:col-span-2"
              error={state?.errors[`matchers.${l.name}`]}
            >
              <CheckboxList
                name={l.name}
                options={l.values.map((v) => ({ value: v.id, label: v.label }))}
                selected={pickList(state, l.name, l.selected)}
              />
            </Field>
          ))}
          <Field name="descriptionContains" label="Description contains (all words)">
            <input
              id="descriptionContains"
              name="descriptionContains"
              defaultValue={pick(state, 'descriptionContains', m.descriptionContains)}
            />
          </Field>
          <Field
            name="descriptionContainsAny"
            label="Description contains any of (comma separated)"
            error={state?.errors['matchers.descriptionContainsAny']}
          >
            <input
              id="descriptionContainsAny"
              name="descriptionContainsAny"
              defaultValue={pick(
                state,
                'descriptionContainsAny',
                (m.descriptionContainsAny ?? []).join(', '),
              )}
            />
          </Field>
          <Field
            name="txnTypes"
            label="Transaction types"
            error={state?.errors['matchers.txnTypes']}
          >
            <CheckboxList
              name="txnTypes"
              options={options.txnTypes.map((t) => ({ value: t, label: t }))}
              selected={pickList(state, 'txnTypes', m.txnTypes ?? [])}
            />
          </Field>
          <Field name="amountSign" label="Amount sign" error={state?.errors['matchers.amountSign']}>
            <select
              id="amountSign"
              name="amountSign"
              defaultValue={pick(state, 'amountSign', m.amountSign ?? '')}
            >
              <option value="">any</option>
              <option value="positive">positive only</option>
              <option value="negative">negative only (credits)</option>
            </select>
          </Field>
          <Field name="dateFrom" label="Match date from" error={state?.errors['matchers.dateFrom']}>
            <input
              id="dateFrom"
              name="dateFrom"
              type="date"
              defaultValue={pick(state, 'dateFrom', m.dateFrom)}
            />
          </Field>
          <Field name="dateTo" label="Match date to" error={state?.errors['matchers.dateTo']}>
            <input
              id="dateTo"
              name="dateTo"
              type="date"
              defaultValue={pick(state, 'dateTo', m.dateTo)}
            />
          </Field>
        </div>
        <div className="mt-4 flex gap-2">
          <button type="submit" className="btn">
            {rule ? 'Save changes' : 'Create rule'}
          </button>
          <button
            type="submit"
            name="intent"
            value="preview"
            formNoValidate
            className="btn btn-secondary"
          >
            Preview
          </button>
        </div>
      </form>
      {preview ? (
        <div className="card mt-4" data-testid="rule-preview">
          <h2>Preview</h2>
          <p>
            <span data-testid="preview-count">{preview.result.count}</span> member lines ·{' '}
            <Money cents={preview.result.totalCents} dollar /> this rule would settle in a recompute
            {preview.result.shadowed > 0
              ? ` · ${preview.result.shadowed} more match but a decision or earlier rule already settles them`
              : ''}
          </p>
          <DataTable caption="Preview affected lines">
            <thead>
              <tr>
                {['Date', 'Doc', 'Account', 'Payee', 'Description'].map((h) => (
                  <Th key={h}>{h}</Th>
                ))}
                <Th num>Amount ($)</Th>
              </tr>
            </thead>
            <tbody>
              {preview.sample.map((l) => (
                <tr key={l.id}>
                  <td>
                    <DateText date={l.txnDate} />
                  </td>
                  <td>{l.docNumber}</td>
                  <td>{l.account}</td>
                  <td>{l.party}</td>
                  <td>{l.description}</td>
                  <NumTd cents={l.amountCents} />
                </tr>
              ))}
            </tbody>
          </DataTable>
        </div>
      ) : null}
    </>
  );
}
