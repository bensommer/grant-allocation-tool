import Link from 'next/link';
import { PageHeader } from '@/components/page-header';
import { Field, FormBanner } from '@/components/form';
import { prisma } from '@/lib/db';
import { getOrgId } from '@/lib/org';
import { decodeFormState, pick } from '@/lib/forms';
import { saveDriversAction } from '../actions';

export const dynamic = 'force-dynamic';
export default async function DriversPage({
  searchParams,
}: {
  searchParams: Promise<{ key?: string; period?: string; f?: string; saved?: string }>;
}) {
  const { key = '', period = '', f, saved } = await searchParams;
  const orgId = await getOrgId();
  const state = decodeFormState(f);
  const [programs, values, rules] = await Promise.all([
    prisma.program.findMany({ where: { orgId, active: true }, orderBy: { code: 'asc' } }),
    prisma.allocationDriverValue.findMany({
      where: { orgId },
      orderBy: [{ driverKey: 'asc' }, { period: 'desc' }],
    }),
    prisma.allocationRule.findMany({
      where: { orgId, driverKey: { not: null } },
      select: { driverKey: true },
    }),
  ]);
  const keys = [
    ...new Set([
      ...values.map((v) => v.driverKey),
      ...rules.map((r) => r.driverKey).filter((k): k is string => !!k),
    ]),
  ].sort();
  const selected = new Map(
    values
      .filter((v) => v.driverKey === key && v.period === period)
      .map((v) => [v.programId, v.value]),
  );
  const names = new Map(programs.map((p) => [p.id, `${p.code} ${p.name}`]));
  return (
    <>
      <PageHeader
        title="Allocation drivers"
        subtitle="Enter monthly integer driver values (e.g. FTE hours) by program."
        actions={
          <Link href="/allocation" className="btn btn-secondary">
            All rules
          </Link>
        }
      />
      <form method="get" className="card mb-4">
        <div className="grid-form">
          <Field name="key" label="Driver key">
            <input id="key" name="key" list="keys" defaultValue={key} />
            <datalist id="keys">
              {keys.map((k) => (
                <option value={k} key={k} />
              ))}
            </datalist>
          </Field>
          <Field name="period" label="Period (YYYY-MM)">
            <input id="period" name="period" placeholder="2026-03" defaultValue={period} />
          </Field>
        </div>
        <button type="submit" className="btn btn-secondary mt-3">
          Load period
        </button>
      </form>
      <form action={saveDriversAction} className="card mb-4">
        <FormBanner state={state} saved={!!saved} />
        <input type="hidden" name="driverKey" value={key} />
        <input type="hidden" name="period" value={period} />
        {state?.errors.driverKey || state?.errors.period || state?.errors.rows ? (
          <p className="field-error">
            {state.errors.driverKey ?? state.errors.period ?? state.errors.rows}
          </p>
        ) : null}
        <h2 className="font-semibold">
          Values for {key || 'a driver'} · {period || 'choose a period'}
        </h2>
        <p className="muted">
          Whole, non-negative integers only. Saving replaces the selected period’s rows.
        </p>
        <table>
          <thead>
            <tr>
              <th>Program</th>
              <th>Value</th>
            </tr>
          </thead>
          <tbody>
            {programs.map((p) => (
              <tr key={p.id}>
                <td>
                  {p.code} {p.name}
                  <input type="hidden" name="programIds" value={p.id} />
                </td>
                <td>
                  <input
                    type="number"
                    min="0"
                    step="1"
                    name={`value_${p.id}`}
                    aria-label={`Value for ${p.code}`}
                    defaultValue={pick(state, `value_${p.id}`, String(selected.get(p.id) ?? 0))}
                  />
                  {state?.errors[`rows.${programs.indexOf(p)}.value`] ? (
                    <p className="field-error">
                      {state.errors[`rows.${programs.indexOf(p)}.value`]}
                    </p>
                  ) : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <button className="btn mt-3" type="submit">
          Save driver values
        </button>
      </form>
      <div className="card">
        <h2 className="font-semibold">All driver values</h2>
        {values.length ? (
          <table>
            <thead>
              <tr>
                <th>Key</th>
                <th>Period</th>
                <th>Program</th>
                <th className="num">Value</th>
              </tr>
            </thead>
            <tbody>
              {values.map((v) => (
                <tr key={v.id}>
                  <td>{v.driverKey}</td>
                  <td>{v.period}</td>
                  <td>{names.get(v.programId) ?? '(inactive program)'}</td>
                  <td className="num">{v.value}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p className="muted">No driver values yet.</p>
        )}
      </div>
    </>
  );
}
