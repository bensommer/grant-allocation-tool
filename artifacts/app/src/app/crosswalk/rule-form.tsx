import { CheckboxList, Field, FormBanner } from '@/components/form';
import { formatCents } from '@/domain/money';
import { formatDate } from '@/domain/dates';
import { parseMatchers, type Matchers } from '@/domain/matchers';
import type { PreviewResult } from '@/engine/preview';
import { pick, pickBool, pickList, type FormState } from '@/lib/forms';
import type { crosswalkOptions } from './options';

type Options = Awaited<ReturnType<typeof crosswalkOptions>>;
type Rule = {
  name: string | null;
  grantBudgetLineId: string;
  priority: number;
  active: boolean;
  matchers: unknown;
};

export function RuleForm({
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
  options: Options;
  preview?: PreviewResult;
  saved?: boolean;
}) {
  const m: Matchers = rule ? parseMatchers(rule.matchers) : {};
  const year = new Date().getFullYear();
  const lists = [
    {
      name: 'programIds',
      label: 'Programs',
      values: options.programs.map((p) => ({ value: p.id, label: `${p.code} ${p.name}` })),
      selected: m.programIds ?? [],
    },
    {
      name: 'accountIds',
      label: 'Expense accounts',
      values: options.accounts.map((a) => ({
        value: a.id,
        label: `${a.number ?? ''} ${a.name}`.trim(),
      })),
      selected: m.accountIds ?? [],
    },
    {
      name: 'classIds',
      label: 'Classes',
      values: options.classes.map((c) => ({ value: c.id, label: c.name })),
      selected: m.classIds ?? [],
    },
    {
      name: 'locationIds',
      label: 'Locations',
      values: options.locations.map((l) => ({ value: l.id, label: l.name })),
      selected: m.locationIds ?? [],
    },
    {
      name: 'partyIds',
      label: 'Parties',
      values: options.parties.map((p) => ({ value: p.id, label: p.displayName })),
      selected: m.partyIds ?? [],
    },
  ];
  return (
    <>
      <form action={action} className="card">
        <FormBanner state={state} saved={saved} />
        {state?.errors['matchers'] ? (
          <p className="field-error">{state.errors['matchers']}</p>
        ) : null}
        <div className="grid-form">
          <Field name="name" label="Name" error={state?.errors['name']}>
            <input id="name" name="name" required defaultValue={pick(state, 'name', rule?.name)} />
          </Field>
          <Field
            name="grantBudgetLineId"
            label="Target budget line"
            error={state?.errors['grantBudgetLineId']}
          >
            <select
              id="grantBudgetLineId"
              name="grantBudgetLineId"
              required
              defaultValue={pick(state, 'grantBudgetLineId', rule?.grantBudgetLineId)}
            >
              <option value="">Select a budget line</option>
              {options.grants.map((g) => (
                <optgroup key={g.id} label={`${g.awardNumber ?? g.name} — ${g.name}`}>
                  {g.budgetLines.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.code} — {b.name}
                    </option>
                  ))}
                </optgroup>
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
                options={l.values}
                selected={pickList(state, l.name, l.selected)}
              />
            </Field>
          ))}
          <Field
            name="accountFrom"
            label="Account range from"
            error={state?.errors['accountRange']}
          >
            <input
              id="accountFrom"
              name="accountFrom"
              defaultValue={pick(state, 'accountFrom', m.accountRange?.from)}
            />
          </Field>
          <Field name="accountTo" label="Account range to">
            <input
              id="accountTo"
              name="accountTo"
              defaultValue={pick(state, 'accountTo', m.accountRange?.to)}
            />
          </Field>
          <Field name="descriptionContains" label="Description contains">
            <input
              id="descriptionContains"
              name="descriptionContains"
              defaultValue={pick(state, 'descriptionContains', m.descriptionContains)}
            />
          </Field>
          <div />
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
        <div className="mt-4 grid-form">
          <Field name="previewFrom" label="Preview from" error={state?.errors['previewFrom']}>
            <input
              id="previewFrom"
              name="previewFrom"
              type="date"
              defaultValue={pick(state, 'previewFrom', `${year}-01-01`)}
            />
          </Field>
          <Field name="previewTo" label="Preview to" error={state?.errors['previewTo']}>
            <input
              id="previewTo"
              name="previewTo"
              type="date"
              defaultValue={pick(state, 'previewTo', `${year}-12-31`)}
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
        <div className="card mt-4">
          <h2>Preview</h2>
          <p>
            {preview.count} pieces · {formatCents(preview.totalCents)} this rule would map
            {preview.contested > 0
              ? ` · ${preview.contested} more tie with another rule at this priority`
              : ''}
          </p>
          <table>
            <thead>
              <tr>
                {[
                  'Date',
                  'Doc',
                  'Account',
                  'Class',
                  'Party',
                  'Description',
                  'Allocated program',
                  'Amount',
                ].map((h) => (
                  <th key={h}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {preview.sample.map((l, i) => (
                <tr key={`${l.sourceLineId}-${i}`}>
                  <td>{formatDate(l.txnDate)}</td>
                  <td>{l.docNumber}</td>
                  <td>{l.account}</td>
                  <td>{l.className}</td>
                  <td>{l.party}</td>
                  <td>{l.description}</td>
                  <td>{l.programCode}</td>
                  <td className="num">{formatCents(l.amountCents)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </>
  );
}
