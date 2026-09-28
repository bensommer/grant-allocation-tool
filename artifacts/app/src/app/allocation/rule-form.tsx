import { TERMS } from '@/copy/terms';
import { CheckboxList, Field, FormBanner } from '@/components/form';
import { Button, Card, DataTable, DateText, Money, NumTd, Th } from '@/components/ui';
import { toISODate } from '@/domain/dates';
import { parseMatchers } from '@/domain/matchers';
import { describeMatchers } from '@/lib/matcher-labels';
import { decodeFormState, pick, pickBool, pickList, type FormState } from '@/lib/forms';
import { previewRule, type PreviewResult } from '@/engine/preview';
import { prisma } from '@/lib/db';
import { SplitTotal } from './split-total';

export async function ruleOptions(orgId: string) {
  const [accounts, classes, locations, parties, programs, grants, drivers] = await Promise.all([
    prisma.account.findMany({
      where: { orgId, type: { in: ['Expense', 'Income', 'COGS', 'OtherExpense', 'OtherIncome'] } },
      orderBy: { number: 'asc' },
    }),
    prisma.trackingClass.findMany({ where: { orgId }, orderBy: { name: 'asc' } }),
    prisma.trackingLocation.findMany({ where: { orgId }, orderBy: { name: 'asc' } }),
    prisma.party.findMany({ where: { orgId }, orderBy: { displayName: 'asc' } }),
    prisma.program.findMany({ where: { orgId, active: true }, orderBy: { code: 'asc' } }),
    prisma.grant.findMany({
      where: { orgId },
      include: { budgetLines: true },
      orderBy: { name: 'asc' },
    }),
    prisma.allocationDriverValue.findMany({
      where: { orgId },
      distinct: ['driverKey'],
      select: { driverKey: true },
    }),
  ]);
  return { accounts, classes, locations, parties, programs, grants, drivers };
}
type Options = Awaited<ReturnType<typeof ruleOptions>>;
type Rule = Awaited<ReturnType<typeof prisma.allocationRule.findFirst>> & {
  targets: Array<{
    sortOrder: number;
    programId: string | null;
    grantBudgetLineId: string | null;
    shareBps: number;
  }>;
};

type EditorQuery = Record<string, string | string[] | undefined>;

/** GET editor controls submit the entire form, including repeated matcher fields. */
export function allocationEditorState(query: EditorQuery): FormState | null {
  if (query.ui !== 'method' && query.ui !== 'add-target') {
    return decodeFormState(typeof query.f === 'string' ? query.f : undefined);
  }
  const values: FormState['values'] = {};
  for (const [key, value] of Object.entries(query)) {
    if (!key.startsWith('$') && key !== 'ui' && key !== 'f' && value !== undefined) {
      values[key] = value;
    }
  }
  // Unchecked checkboxes are absent from GET submissions; do not fall back to saved matchers.
  for (const key of ['accountIds', 'classIds', 'locationIds', 'partyIds']) {
    values[key] ??= [];
  }
  return { errors: {}, values };
}

export async function RuleForm({
  action,
  state,
  saved,
  rule,
  options,
  orgId,
  editorPath,
  ui,
}: {
  action: (form: FormData) => Promise<void>;
  state: FormState | null;
  saved?: boolean;
  rule: Rule | null;
  options: Options;
  orgId: string;
  editorPath: string;
  ui?: string | string[];
}) {
  const m = parseMatchers(rule?.matchers);
  const selectedMethod = pick(state, 'method', rule?.method ?? 'fixed_pct');
  const submittedRows = Math.max(
    0,
    ...Object.keys(state?.values ?? {})
      .filter((key) => /^program_[0-5]$/.test(key))
      .map((key) => Number(key.slice(-1)) + 1),
  );
  const rows = Math.min(
    6,
    Math.max(1, submittedRows + (ui === 'add-target' ? 1 : 0), rule?.targets.length || 0),
  );
  const accountNames = new Map(options.accounts.map((a) => [a.id, a.name]));
  const programNames = new Map(options.programs.map((p) => [p.id, p.name]));
  const budgetNames = new Map(
    options.grants.flatMap((g) => g.budgetLines.map((b) => [b.id, b.name] as const)),
  );
  const summary = rule
    ? `Splits ${describeMatchers(m, {
        accounts: accountNames,
        programs: programNames,
        classes: new Map(options.classes.map((c) => [c.id, c.name])),
        locations: new Map(options.locations.map((l) => [l.id, l.name])),
        parties: new Map(options.parties.map((p) => [p.id, p.displayName])),
      })}: ${rule.targets.map((t) => `${rule.method === 'fixed_pct' ? `${(t.shareBps / 100).toFixed(1)}% ` : ''}${programNames.get(t.programId ?? '') ?? budgetNames.get(t.grantBudgetLineId ?? '') ?? 'Unknown target'}`).join(', ')}`
    : 'Choose conditions and targets to describe this split.';
  const field = (name: string, label: string, fallback = '', hint?: string) => (
    <Field name={name} label={label} error={state?.errors[name]} hint={hint}>
      <input id={name} name={name} defaultValue={pick(state, name, fallback)} />
    </Field>
  );
  const check = (
    name: 'accountIds' | 'classIds' | 'locationIds' | 'partyIds',
    label: string,
    optionsList: { value: string; label: string }[],
  ) => (
    <Field name={name} label={label} error={state?.errors[name]}>
      <CheckboxList
        name={name}
        options={optionsList}
        selected={pickList(state, name, m[name] ?? [])}
      />
    </Field>
  );
  let preview: PreviewResult | null = null;
  if (state && state.values.intent === 'preview' && !state.errors.previewFrom) {
    try {
      const { parseDateInput } = await import('@/domain/dates');
      const matchers = {
        accountIds: pickList(state, 'accountIds', []),
        classIds: pickList(state, 'classIds', []),
        locationIds: pickList(state, 'locationIds', []),
        partyIds: pickList(state, 'partyIds', []),
        ...(pick(state, 'accountFrom', '') && pick(state, 'accountTo', '')
          ? {
              accountRange: {
                from: pick(state, 'accountFrom', ''),
                to: pick(state, 'accountTo', ''),
              },
            }
          : {}),
        descriptionContains: pick(state, 'descriptionContains', ''),
        dateFrom: pick(state, 'dateFrom', '') || undefined,
        dateTo: pick(state, 'dateTo', '') || undefined,
      };
      const eff = (name: string) =>
        pick(state, name, '') ? parseDateInput(pick(state, name, '')) : null;
      preview = await previewRule(
        orgId,
        {
          kind: 'allocation',
          matchers,
          priority: Number(pick(state, 'priority', '100')) || 0,
          effectiveFrom: eff('effectiveFrom'),
          effectiveTo: eff('effectiveTo'),
          ruleId: rule?.id,
          method:
            pick(state, 'method', 'fixed_pct') === 'ratio_of_driver'
              ? 'ratio_of_driver'
              : 'fixed_pct',
          driverKey: pick(state, 'driverKey', '') || null,
        },
        {
          from: parseDateInput(pick(state, 'previewFrom', '')),
          to: parseDateInput(pick(state, 'previewTo', '')),
        },
      );
    } catch {
      /* invalid dates are reported by the action */
    }
  }
  const shares = Array.from({ length: rows }, (_, i) => {
    const target = rule?.targets.find((t) => t.sortOrder === i);
    return pick(state, `share_${i}`, target ? (target.shareBps / 100).toFixed(2) : '');
  });
  const selectedParties = pickList(state, 'partyIds', m.partyIds ?? []);
  const partyGroups = (
    [
      ['Funders', (kind: string) => kind === 'customer' || kind === 'project'],
      ['Vendors', (kind: string) => kind === 'vendor'],
      ['Employees', (kind: string) => kind === 'employee'],
    ] as const
  ).map(([label, match]) => {
    const items = options.parties
      .filter((party) => match(party.kind))
      .map((party) => ({ value: party.id, label: party.displayName }));
    return {
      label,
      options: items,
      selected: items.filter((o) => selectedParties.includes(o.value)).length,
    };
  });
  return (
    <>
      <form action={action}>
        <FormBanner state={state} saved={saved} />
        <Card title="What it applies to">
          <p className="muted">Match the transactions this rule will split.</p>
          <p className="mb-3">{summary}</p>
          <div className="grid-form">
            {field('name', 'Rule name', rule?.name ?? '')}
            {field('priority', 'Priority (lower wins)', String(rule?.priority ?? 100))}
          </div>
          {state?.errors.matchers ? <p className="field-error">{state.errors.matchers}</p> : null}
          <div className="grid-form">
            {check(
              'accountIds',
              'Accounts (expense and income)',
              options.accounts.map((a) => ({
                value: a.id,
                label: `${a.name} ${a.number ?? ''}`.trim(),
              })),
            )}
            {check(
              'classIds',
              'Classes',
              options.classes.map((c) => ({ value: c.id, label: c.name })),
            )}
            {check(
              'locationIds',
              'Locations',
              options.locations.map((l) => ({ value: l.id, label: l.name })),
            )}
            <fieldset>
              <legend className="mb-0.5 text-xs font-semibold text-ink-soft">{TERMS.namesShort}</legend>
              {partyGroups.map((group) => (
                <details key={group.label} className="party-group" open={group.selected > 0}>
                  <summary>
                    {group.label}
                    <span className="muted font-normal" data-party-count={group.label}>
                      {' '}
                      · {group.selected} selected
                    </span>
                  </summary>
                  <CheckboxList
                    name="partyIds"
                    options={group.options}
                    selected={selectedParties}
                  />
                </details>
              ))}
              {state?.errors.partyIds ? (
                <p className="field-error">{state.errors.partyIds}</p>
              ) : null}
            </fieldset>
            <div className="flex gap-2">
              {field('accountFrom', 'Account range from', m.accountRange?.from)}
              {field('accountTo', 'Account range to', m.accountRange?.to)}
            </div>
            {field('descriptionContains', 'Description contains', m.descriptionContains)}
            {(['dateFrom', 'dateTo'] as const).map((name) => (
              <Field
                key={name}
                name={name}
                label={name === 'dateFrom' ? 'Transaction date from' : 'Transaction date to'}
                error={state?.errors[name]}
              >
                <input
                  id={name}
                  name={name}
                  type="date"
                  defaultValue={pick(state, name, m[name])}
                />
              </Field>
            ))}
          </div>
        </Card>
        <div className="mt-4">
          <Card title="How it splits">
            <p className="muted">
              Choose a program or grant budget line for each target. Fixed shares must total 100%.
            </p>
            <div className="mb-3 flex flex-wrap items-end gap-3">
              <Field name="method" label="Split method" error={state?.errors.method}>
                <select id="method" name="method" defaultValue={selectedMethod}>
                  <option value="fixed_pct">Fixed %</option>
                  <option value="ratio_of_driver">Driver ratio</option>
                </select>
              </Field>
              <Button
                variant="secondary"
                formMethod="get"
                formAction={editorPath}
                name="ui"
                value="method"
              >
                Change method
              </Button>
            </div>
            {selectedMethod === 'ratio_of_driver' ? (
              <Field name="driverKey" label="Driver key" error={state?.errors.driverKey}>
                <input
                  id="driverKey"
                  name="driverKey"
                  list="driverKeys"
                  defaultValue={pick(state, 'driverKey', rule?.driverKey)}
                />
                <datalist id="driverKeys">
                  {options.drivers.map((d) => (
                    <option key={d.driverKey} value={d.driverKey} />
                  ))}
                </datalist>
              </Field>
            ) : null}
            {state?.errors.targets ? <p className="field-error">{state.errors.targets}</p> : null}
            <SplitTotal initial={selectedMethod === 'fixed_pct' ? shares : []} rows={rows}>
              <DataTable caption="Split targets">
                <thead>
                  <tr>
                    <Th>Program</Th>
                    <Th>Grant budget line</Th>
                    {selectedMethod === 'fixed_pct' ? <Th>Share %</Th> : null}
                  </tr>
                </thead>
                <tbody>
                  {shares.map((share, i) => {
                    const target = rule?.targets.find((t) => t.sortOrder === i);
                    return (
                      <tr key={i}>
                        <td>
                          <select
                            name={`program_${i}`}
                            aria-label={`Program ${i + 1}`}
                            defaultValue={pick(state, `program_${i}`, target?.programId)}
                          >
                            <option value="">— none —</option>
                            {options.programs.map((p) => (
                              <option key={p.id} value={p.id}>
                                {p.name} ({p.code})
                              </option>
                            ))}
                          </select>
                        </td>
                        <td>
                          <select
                            name={`budgetLine_${i}`}
                            aria-label={`Budget line ${i + 1}`}
                            defaultValue={pick(state, `budgetLine_${i}`, target?.grantBudgetLineId)}
                          >
                            <option value="">— none —</option>
                            {options.grants.map((g) => (
                              <optgroup key={g.id} label={g.name}>
                                {g.budgetLines.map((b) => (
                                  <option key={b.id} value={b.id}>
                                    {b.name} ({b.code})
                                  </option>
                                ))}
                              </optgroup>
                            ))}
                          </select>
                        </td>
                        {selectedMethod === 'fixed_pct' ? (
                          <td>
                            <input
                              name={`share_${i}`}
                              aria-label={`Share ${i + 1}`}
                              inputMode="decimal"
                              defaultValue={share}
                            />
                            {state?.errors[`share_${i}`] ? (
                              <p className="field-error">{state.errors[`share_${i}`]}</p>
                            ) : null}
                          </td>
                        ) : (
                          <td hidden>
                            <input type="hidden" name={`share_${i}`} value={share} />
                          </td>
                        )}
                      </tr>
                    );
                  })}
                </tbody>
              </DataTable>
              {rows < 6 ? (
                <Button
                  variant="secondary"
                  formMethod="get"
                  formAction={editorPath}
                  name="ui"
                  value="add-target"
                  data-add-target="true"
                >
                  Add target
                </Button>
              ) : null}
            </SplitTotal>
          </Card>
        </div>
        <div className="mt-4">
          <Card title="When">
            <p className="muted">Limit when this rule is effective, or leave dates blank.</p>
            <div className="grid-form">
              {(['effectiveFrom', 'effectiveTo'] as const).map((name) => (
                <Field
                  key={name}
                  name={name}
                  label={name === 'effectiveFrom' ? 'Effective from' : 'Effective to'}
                  error={state?.errors[name]}
                >
                  <input
                    id={name}
                    name={name}
                    type="date"
                    defaultValue={pick(state, name, rule?.[name] ? toISODate(rule[name]) : '')}
                  />
                </Field>
              ))}
              <Field name="active" label="Active" error={state?.errors.active}>
                <input
                  id="active"
                  name="active"
                  type="checkbox"
                  defaultChecked={pickBool(state, 'active', rule?.active ?? true)}
                />
              </Field>
            </div>
          </Card>
        </div>
        <div className="mt-4">
          <Card title="Preview">
            <p className="muted">See affected lines before saving.</p>
            <div className="grid-form">
              {(['previewFrom', 'previewTo'] as const).map((name) => (
                <Field
                  key={name}
                  name={name}
                  label={name === 'previewFrom' ? 'Preview from' : 'Preview to'}
                  error={state?.errors[name]}
                >
                  <input id={name} name={name} type="date" defaultValue={pick(state, name, '')} />
                </Field>
              ))}
            </div>
          </Card>
        </div>
        <div className="mt-4 flex gap-2">
          <button className="btn" type="submit" name="intent" value="save">
            {rule ? 'Save changes' : 'Create rule'}
          </button>
          <button
            className="btn btn-secondary"
            type="submit"
            name="intent"
            value="preview"
            formNoValidate
          >
            Preview
          </button>
        </div>
      </form>
      {preview ? (
        <div className="card mt-4">
          <h2 className="font-semibold">
            Preview: {preview.count} lines · <Money cents={preview.totalCents} dollar /> this rule
            would split
            {preview.contested > 0
              ? ` · ${preview.contested} tie with another rule at this priority`
              : ''}
          </h2>
          <p className="muted">
            First {preview.sample.length} lines; this preview does not save or recompute.
          </p>
          <DataTable caption="Affected lines">
            <thead>
              <tr>
                <Th>Date</Th>
                <Th>Document</Th>
                <Th>Account</Th>
                <Th>Description</Th>
                <Th num>Amount ($)</Th>
              </tr>
            </thead>
            <tbody>
              {preview.sample.map((line) => (
                <tr key={line.sourceLineId}>
                  <td>
                    <DateText date={line.txnDate} />
                  </td>
                  <td>{line.docNumber}</td>
                  <td>{line.account}</td>
                  <td>{line.description}</td>
                  <NumTd cents={line.amountCents} />
                </tr>
              ))}
            </tbody>
          </DataTable>
        </div>
      ) : null}
    </>
  );
}
