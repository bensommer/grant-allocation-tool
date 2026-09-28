import { Field } from '@/components/form';
import { RESTRICTION_TYPES } from '@/domain/grant-draft';
import { type FormState, pick } from '@/lib/forms';
import { RESTRICTION_LABEL } from '../../labels';

/** Step 1 — the award, straight from the award letter. */
export function StepAward({
  state,
  customers,
}: {
  state: FormState;
  customers: Array<{ id: string; displayName: string }>;
}) {
  const e = state.errors;
  return (
    <div className="grid gap-3 md:grid-cols-2">
      <Field label="Grant name" name="name" error={e['name']} className="md:col-span-2">
        <input id="name" name="name" required defaultValue={pick(state, 'name', '')} />
      </Field>
      <Field
        label="Funder"
        name="funderText"
        error={e['funderText']}
        hint="Start typing to pick a QuickBooks customer, or enter a new funder name."
      >
        <input
          id="funderText"
          name="funderText"
          list="funder-names"
          autoComplete="off"
          required
          defaultValue={pick(state, 'funderText', '')}
        />
        <datalist id="funder-names">
          {customers.map((c) => (
            <option key={c.id} value={c.displayName} />
          ))}
        </datalist>
      </Field>
      <Field label="Award number" name="awardNumber" error={e['awardNumber']}>
        <input id="awardNumber" name="awardNumber" defaultValue={pick(state, 'awardNumber', '')} />
      </Field>
      <Field
        label="Award amount"
        name="awardAmount"
        error={e['awardAmount']}
        hint="Amount and dates come from the award letter."
      >
        <input
          id="awardAmount"
          name="awardAmount"
          inputMode="decimal"
          required
          placeholder="e.g. 120,000.00"
          defaultValue={pick(state, 'awardAmount', '')}
        />
      </Field>
      <Field label="Restriction type" name="restrictionType" error={e['restrictionType']}>
        <select
          id="restrictionType"
          name="restrictionType"
          defaultValue={pick(state, 'restrictionType', 'purpose')}
        >
          {RESTRICTION_TYPES.map((r) => (
            <option key={r} value={r}>
              {RESTRICTION_LABEL[r]}
            </option>
          ))}
        </select>
      </Field>
      <Field label="Start date" name="startDate" error={e['startDate']}>
        <input
          id="startDate"
          name="startDate"
          type="date"
          required
          defaultValue={pick(state, 'startDate', '')}
        />
      </Field>
      <Field label="End date" name="endDate" error={e['endDate']}>
        <input
          id="endDate"
          name="endDate"
          type="date"
          required
          defaultValue={pick(state, 'endDate', '')}
        />
      </Field>
    </div>
  );
}
