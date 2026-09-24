import { CheckboxList, Field, FormBanner } from '@/components/form';
import { type FormState, pick, pickBool, pickList } from '@/lib/forms';
import { CATEGORY_LABEL } from './labels';

export interface ProgramFormProps {
  action: (formData: FormData) => Promise<void>;
  state: FormState | null;
  saved?: boolean;
  program: {
    code: string;
    name: string;
    description: string | null;
    functionalCategory: keyof typeof CATEGORY_LABEL;
    matchClassIds: string[];
    active: boolean;
  } | null;
  classes: Array<{ id: string; name: string; takenBy: string | null }>;
  submitLabel: string;
}

export function ProgramForm({
  action,
  state,
  saved,
  program,
  classes,
  submitLabel,
}: ProgramFormProps) {
  return (
    <form action={action} className="card">
      <FormBanner state={state} saved={saved} />
      <div className="grid-form">
        <Field
          label="Code"
          name="code"
          error={state?.errors['code']}
          hint="Short unique identifier, e.g. CT"
        >
          <input
            id="code"
            name="code"
            required
            maxLength={20}
            defaultValue={pick(state, 'code', program?.code)}
          />
        </Field>
        <Field label="Name" name="name" error={state?.errors['name']}>
          <input
            id="name"
            name="name"
            required
            maxLength={120}
            defaultValue={pick(state, 'name', program?.name)}
          />
        </Field>
        <Field
          label="Functional category"
          name="functionalCategory"
          error={state?.errors['functionalCategory']}
        >
          <select
            id="functionalCategory"
            name="functionalCategory"
            defaultValue={pick(
              state,
              'functionalCategory',
              program?.functionalCategory ?? 'program',
            )}
          >
            {Object.entries(CATEGORY_LABEL).map(([v, l]) => (
              <option key={v} value={v}>
                {l}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Active" name="active">
          <input
            id="active"
            type="checkbox"
            name="active"
            defaultChecked={pickBool(state, 'active', program?.active ?? true)}
          />
        </Field>
        <Field
          label="Description"
          name="description"
          error={state?.errors['description']}
          className="md:col-span-2"
        >
          <textarea
            id="description"
            name="description"
            rows={2}
            defaultValue={pick(state, 'description', program?.description)}
          />
        </Field>
        <Field
          label="Default class mapping"
          name="matchClassIds"
          error={state?.errors['matchClassIds']}
          hint="Lines carrying one of these QuickBooks classes go 100% to this program unless an allocation rule splits them."
          className="md:col-span-2"
        >
          <CheckboxList
            name="matchClassIds"
            options={classes.map((c) => ({
              value: c.id,
              label: c.name,
              note: c.takenBy ? `default for ${c.takenBy}` : undefined,
            }))}
            selected={pickList(state, 'matchClassIds', program?.matchClassIds ?? [])}
          />
        </Field>
      </div>
      <div className="mt-4 flex gap-2">
        <button type="submit" className="btn">
          {submitLabel}
        </button>
      </div>
    </form>
  );
}
