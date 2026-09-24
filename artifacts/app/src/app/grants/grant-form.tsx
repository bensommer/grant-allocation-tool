import { CheckboxList, Field, FormBanner } from '@/components/form';
import { type FormState, pick, pickList } from '@/lib/forms';
import { centsToDecimalString, formatBps } from '@/domain/money';
import { toISODate } from '@/domain/dates';
import { GRANT_STATUS_LABEL, RESTRICTION_LABEL } from './labels';

export interface GrantFormData {
  name: string;
  funder: string;
  funderPartyId: string | null;
  awardNumber: string | null;
  startDate: Date;
  endDate: Date;
  awardAmountCents: number;
  restrictionType: keyof typeof RESTRICTION_LABEL;
  status: keyof typeof GRANT_STATUS_LABEL;
  matchPartyIds: string[];
  matchClassIds: string[];
  programs: Array<{ programId: string; plannedShareBps: number | null }>;
}

export function GrantForm({
  action,
  state,
  saved,
  grant,
  customers,
  classes,
  programs,
  submitLabel,
}: {
  action: (formData: FormData) => Promise<void>;
  state: FormState | null;
  saved?: boolean;
  grant: GrantFormData | null;
  customers: Array<{ id: string; displayName: string }>;
  classes: Array<{ id: string; name: string }>;
  programs: Array<{ id: string; code: string; name: string }>;
  submitLabel: string;
}) {
  const selectedPrograms = pickList(
    state,
    'programIds',
    grant?.programs.map((p) => p.programId) ?? [],
  );
  const shareFor = (programId: string) => {
    const stored = grant?.programs.find((p) => p.programId === programId)?.plannedShareBps;
    return pick(
      state,
      `plannedShare_${programId}`,
      stored == null ? '' : formatBps(stored).replace('%', ''),
    );
  };
  return (
    <form action={action} className="card">
      <FormBanner state={state} saved={saved} />
      <div className="grid-form">
        <Field
          label="Grant name"
          name="name"
          error={state?.errors['name']}
          className="md:col-span-2"
        >
          <input id="name" name="name" required defaultValue={pick(state, 'name', grant?.name)} />
        </Field>
        <Field
          label="Funder (imported customer)"
          name="funderPartyId"
          error={state?.errors['funderPartyId']}
          hint="Or type a funder name below."
        >
          <select
            id="funderPartyId"
            name="funderPartyId"
            defaultValue={pick(state, 'funderPartyId', grant?.funderPartyId)}
          >
            <option value="">— free text —</option>
            {customers.map((c) => (
              <option key={c.id} value={c.id}>
                {c.displayName}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Funder name (free text)" name="funderText" error={state?.errors['funder']}>
          <input
            id="funderText"
            name="funderText"
            defaultValue={pick(state, 'funderText', grant?.funderPartyId ? '' : grant?.funder)}
          />
        </Field>
        <Field label="Award number" name="awardNumber" error={state?.errors['awardNumber']}>
          <input
            id="awardNumber"
            name="awardNumber"
            defaultValue={pick(state, 'awardNumber', grant?.awardNumber)}
          />
        </Field>
        <Field
          label="Award amount"
          name="awardAmount"
          error={state?.errors['awardAmount'] ?? state?.errors['awardAmountCents']}
          hint="e.g. 120,000.00"
        >
          <input
            id="awardAmount"
            name="awardAmount"
            required
            inputMode="decimal"
            defaultValue={pick(
              state,
              'awardAmount',
              grant ? centsToDecimalString(grant.awardAmountCents) : '',
            )}
          />
        </Field>
        <Field label="Start date" name="startDate" error={state?.errors['startDate']}>
          <input
            id="startDate"
            name="startDate"
            type="date"
            required
            defaultValue={pick(state, 'startDate', grant ? toISODate(grant.startDate) : '')}
          />
        </Field>
        <Field label="End date" name="endDate" error={state?.errors['endDate']}>
          <input
            id="endDate"
            name="endDate"
            type="date"
            required
            defaultValue={pick(state, 'endDate', grant ? toISODate(grant.endDate) : '')}
          />
        </Field>
        <Field
          label="Restriction type"
          name="restrictionType"
          error={state?.errors['restrictionType']}
        >
          <select
            id="restrictionType"
            name="restrictionType"
            defaultValue={pick(state, 'restrictionType', grant?.restrictionType ?? 'purpose')}
          >
            {Object.entries(RESTRICTION_LABEL).map(([v, l]) => (
              <option key={v} value={v}>
                {l}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Status" name="status" error={state?.errors['status']}>
          <select
            id="status"
            name="status"
            defaultValue={pick(state, 'status', grant?.status ?? 'active')}
          >
            {Object.entries(GRANT_STATUS_LABEL).map(([v, l]) => (
              <option key={v} value={v}>
                {l}
              </option>
            ))}
          </select>
        </Field>
        <Field
          label="Programs funded"
          name="programIds"
          error={state?.errors['programs']}
          hint="Optional planned share (%) per program."
          className="md:col-span-2"
        >
          <div className="flex flex-col gap-1 rounded border border-line bg-white p-2">
            {programs.length === 0 ? (
              <p className="muted text-xs">No programs defined yet.</p>
            ) : null}
            {programs.map((p) => (
              <div key={p.id} className="flex items-center gap-2">
                <label className="flex items-center gap-2 text-sm font-normal normal-case text-ink">
                  <input
                    type="checkbox"
                    name="programIds"
                    value={p.id}
                    defaultChecked={selectedPrograms.includes(p.id)}
                  />
                  <span>
                    {p.code} · {p.name}
                  </span>
                </label>
                <input
                  name={`plannedShare_${p.id}`}
                  aria-label={`Planned share for ${p.code}`}
                  className="!w-20"
                  placeholder="%"
                  inputMode="decimal"
                  defaultValue={shareFor(p.id)}
                />
                {state?.errors[`plannedShare_${p.id}`] ? (
                  <span className="field-error">{state.errors[`plannedShare_${p.id}`]}</span>
                ) : null}
              </div>
            ))}
          </div>
        </Field>
        <Field
          label="Revenue matcher — parties"
          name="matchPartyIds"
          hint="Income lines from these parties count as this grant's receipts."
        >
          <CheckboxList
            name="matchPartyIds"
            options={customers.map((c) => ({ value: c.id, label: c.displayName }))}
            selected={pickList(state, 'matchPartyIds', grant?.matchPartyIds ?? [])}
          />
        </Field>
        <Field
          label="Revenue matcher — classes"
          name="matchClassIds"
          hint="Optional: income lines tagged with these classes."
        >
          <CheckboxList
            name="matchClassIds"
            options={classes.map((c) => ({ value: c.id, label: c.name }))}
            selected={pickList(state, 'matchClassIds', grant?.matchClassIds ?? [])}
          />
        </Field>
      </div>
      <div className="mt-4">
        <button type="submit" className="btn">
          {submitLabel}
        </button>
      </div>
    </form>
  );
}
