import { CheckboxList, Field, FormBanner } from '@/components/form';
import { toISODate } from '@/domain/dates';
import { formatCents } from '@/domain/money';
import { parseMatchers } from '@/domain/matchers';
import { pick, pickBool, pickList, type FormState } from '@/lib/forms';
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

export async function RuleForm({
  action,
  state,
  saved,
  rule,
  options,
  orgId,
}: {
  action: (form: FormData) => Promise<void>;
  state: FormState | null;
  saved?: boolean;
  rule: Rule | null;
  options: Options;
  orgId: string;
}) {
  const m = parseMatchers(rule?.matchers);
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
  const shares = Array.from({ length: 6 }, (_, i) => {
    const target = rule?.targets.find((t) => t.sortOrder === i);
    return pick(state, `share_${i}`, target ? (target.shareBps / 100).toFixed(2) : '');
  });
  return (
    <>
      <form action={action} className="card">
        <FormBanner state={state} saved={saved} />
        <div className="grid-form">
          {field('name', 'Rule name', rule?.name ?? '')}
          <Field name="method" label="Method" error={state?.errors.method}>
            <select
              id="method"
              name="method"
              defaultValue={pick(state, 'method', rule?.method ?? 'fixed_pct')}
            >
              <option value="fixed_pct">Fixed %</option>
              <option value="ratio_of_driver">Driver ratio</option>
            </select>
          </Field>
          <Field
            name="driverKey"
            label="Driver key"
            error={state?.errors.driverKey}
            hint="Required for driver ratio."
          >
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
          {field('priority', 'Priority (lower wins)', String(rule?.priority ?? 100))}
          {field(
            'effectiveFrom',
            'Effective from (YYYY-MM-DD)',
            rule?.effectiveFrom ? toISODate(rule.effectiveFrom) : '',
          )}
          {field(
            'effectiveTo',
            'Effective to (YYYY-MM-DD)',
            rule?.effectiveTo ? toISODate(rule.effectiveTo) : '',
          )}
          <Field name="active" label="Active" error={state?.errors.active}>
            <input
              id="active"
              name="active"
              type="checkbox"
              defaultChecked={pickBool(state, 'active', rule?.active ?? true)}
            />
          </Field>
        </div>
        <h2 className="mt-5 mb-2 font-semibold">Conditions</h2>
        {state?.errors.matchers ? <p className="field-error">{state.errors.matchers}</p> : null}
        <div className="grid-form">
          {check(
            'accountIds',
            'Accounts (expense and income)',
            options.accounts.map((a) => ({
              value: a.id,
              label: `${a.number ?? ''} ${a.name}`.trim(),
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
          {check(
            'partyIds',
            'Parties',
            options.parties.map((p) => ({ value: p.id, label: p.displayName })),
          )}
          {field('accountFrom', 'Account range from', m.accountRange?.from)}
          {field('accountTo', 'Account range to', m.accountRange?.to)}
          {field('descriptionContains', 'Description contains', m.descriptionContains)}
          {field('dateFrom', 'Transaction date from', m.dateFrom)}
          {field('dateTo', 'Transaction date to', m.dateTo)}
        </div>
        <h2 className="mt-5 mb-2 font-semibold">Split targets</h2>
        <p className="muted">
          Choose a program or a grant budget line for each row; leave unused rows blank. Fixed
          shares must total 100%.
        </p>
        {state?.errors.targets ? <p className="field-error">{state.errors.targets}</p> : null}
        <SplitTotal initial={shares}>
          <div className="overflow-x-auto">
            <table>
              <thead>
                <tr>
                  <th>Program</th>
                  <th>Grant budget line</th>
                  <th>Share %</th>
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
                              {p.code} {p.name}
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
                                  {b.code} {b.name}
                                </option>
                              ))}
                            </optgroup>
                          ))}
                        </select>
                      </td>
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
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </SplitTotal>
        <h2 className="mt-5 mb-2 font-semibold">Preview affected lines</h2>
        <div className="grid-form">
          {field('previewFrom', 'Preview from', '')}
          {field('previewTo', 'Preview to', '')}
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
            Preview: {preview.count} lines · {formatCents(preview.totalCents)} this rule would split
            {preview.contested > 0
              ? ` · ${preview.contested} tie with another rule at this priority`
              : ''}
          </h2>
          <p className="muted">
            First {preview.sample.length} lines; this preview does not save or recompute.
          </p>
          <table>
            <thead>
              <tr>
                <th>Date</th>
                <th>Document</th>
                <th>Account</th>
                <th>Description</th>
                <th className="num">Amount</th>
              </tr>
            </thead>
            <tbody>
              {preview.sample.map((line) => (
                <tr key={line.sourceLineId}>
                  <td>{toISODate(line.txnDate)}</td>
                  <td>{line.docNumber}</td>
                  <td>{line.account}</td>
                  <td>{line.description}</td>
                  <td className="num">{formatCents(line.amountCents)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </>
  );
}
