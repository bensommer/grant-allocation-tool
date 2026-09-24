import Link from 'next/link';
import { notFound } from 'next/navigation';
import { PageHeader } from '@/components/page-header';
import { FormBanner } from '@/components/form';
import { prisma } from '@/lib/db';
import { getOrgId } from '@/lib/org';
import { decodeFormState, pick } from '@/lib/forms';
import { centsToDecimalString, formatCents } from '@/domain/money';
import { deleteBudgetLineAction, saveBudgetLineAction } from '../../actions';
import { GrantTabs } from '../tabs';

export const dynamic = 'force-dynamic';

export default async function BudgetPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ f?: string; saved?: string; imported?: string; updated?: string }>;
}) {
  const { id } = await params;
  const { f, saved, imported, updated } = await searchParams;
  const orgId = await getOrgId();
  const grant = await prisma.grant.findFirst({
    where: { id, orgId },
    include: { budgetLines: { orderBy: [{ sortOrder: 'asc' }, { code: 'asc' }] } },
  });
  if (!grant) notFound();
  const programs = await prisma.program.findMany({
    where: { orgId, active: true },
    orderBy: { code: 'asc' },
  });
  const state = decodeFormState(f);
  const total = grant.budgetLines.reduce((a, b) => a + b.budgetCents, 0);
  const diff = total - grant.awardAmountCents;
  // errors for a given row are prefixed with `<lineId>.`; new-row errors are unprefixed
  const rowErr = (lineId: string | null, field: string) =>
    state?.errors[lineId ? `${lineId}.${field}` : field];
  const rowState = (lineId: string | null) =>
    lineId
      ? state?.values['$row'] === lineId
        ? state
        : null
      : state?.values['$row']
        ? null
        : state;

  return (
    <>
      <PageHeader
        title={`${grant.name} · budget lines`}
        subtitle="Funder budget categories. Crosswalk rules map allocated expense onto these lines."
        actions={
          <Link href={`/grants/${id}/budget/import`} className="btn btn-secondary btn-sm">
            Import CSV
          </Link>
        }
      />
      <GrantTabs id={id} active="budget" />
      <FormBanner state={state} saved={!!saved} />
      {imported !== undefined ? (
        <div className="banner banner-ok">
          Imported {imported} new and {updated} updated budget lines.
        </div>
      ) : null}
      <div className="card mb-4 max-w-full overflow-x-auto">
        <table>
          <thead>
            <tr>
              <th>Code</th>
              <th>Name</th>
              <th className="num">Budget</th>
              <th>Program</th>
              <th className="num">Order</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {grant.budgetLines.map((bl) => {
              const s = rowState(bl.id);
              return (
                <tr key={bl.id}>
                  <td>
                    <form id={`edit-${bl.id}`} action={saveBudgetLineAction.bind(null, id, bl.id)}>
                      <input type="hidden" name="$row" value={bl.id} />
                      <input
                        name="code"
                        defaultValue={pick(s, 'code', bl.code)}
                        className="!w-24"
                        aria-label="Code"
                      />
                    </form>
                    {rowErr(bl.id, 'code') ? (
                      <p className="field-error">{rowErr(bl.id, 'code')}</p>
                    ) : null}
                  </td>
                  <td>
                    <input
                      form={`edit-${bl.id}`}
                      name="name"
                      defaultValue={pick(s, 'name', bl.name)}
                      aria-label="Name"
                    />
                    {rowErr(bl.id, 'name') ? (
                      <p className="field-error">{rowErr(bl.id, 'name')}</p>
                    ) : null}
                  </td>
                  <td className="num">
                    <input
                      form={`edit-${bl.id}`}
                      name="budget"
                      defaultValue={pick(s, 'budget', centsToDecimalString(bl.budgetCents))}
                      className="!w-32 text-right"
                      inputMode="decimal"
                      aria-label="Budget"
                    />
                    {rowErr(bl.id, 'budget') ? (
                      <p className="field-error">{rowErr(bl.id, 'budget')}</p>
                    ) : null}
                  </td>
                  <td>
                    <select
                      form={`edit-${bl.id}`}
                      name="programId"
                      defaultValue={pick(s, 'programId', bl.programId)}
                      aria-label="Program"
                    >
                      <option value="">— none —</option>
                      {programs.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.code}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className="num">
                    <input
                      form={`edit-${bl.id}`}
                      name="sortOrder"
                      defaultValue={pick(s, 'sortOrder', String(bl.sortOrder))}
                      className="!w-16 text-right"
                      inputMode="numeric"
                      aria-label="Sort order"
                    />
                  </td>
                  <td className="whitespace-nowrap">
                    <button form={`edit-${bl.id}`} type="submit" className="btn btn-sm">
                      Save
                    </button>{' '}
                    <form
                      action={deleteBudgetLineAction.bind(null, id, bl.id)}

                      className="inline"
                    >
                      <button type="submit" className="btn btn-danger btn-sm">
                        Delete
                      </button>
                    </form>
                  </td>
                </tr>
              );
            })}
            <tr className="bg-paper-2">
              <td>
                <form id="new-line" action={saveBudgetLineAction.bind(null, id, null)}>
                  <input
                    name="code"
                    placeholder="CODE"
                    defaultValue={pick(rowState(null), 'code', '')}
                    className="!w-24"
                    aria-label="New code"
                  />
                </form>
                {rowErr(null, 'code') ? (
                  <p className="field-error">{rowErr(null, 'code')}</p>
                ) : null}
              </td>
              <td>
                <input
                  form="new-line"
                  name="name"
                  placeholder="Budget line name"
                  defaultValue={pick(rowState(null), 'name', '')}
                  aria-label="New name"
                />
                {rowErr(null, 'name') ? (
                  <p className="field-error">{rowErr(null, 'name')}</p>
                ) : null}
              </td>
              <td className="num">
                <input
                  form="new-line"
                  name="budget"
                  placeholder="0.00"
                  defaultValue={pick(rowState(null), 'budget', '')}
                  className="!w-32 text-right"
                  inputMode="decimal"
                  aria-label="New budget"
                />
                {rowErr(null, 'budget') ? (
                  <p className="field-error">{rowErr(null, 'budget')}</p>
                ) : null}
              </td>
              <td>
                <select
                  form="new-line"
                  name="programId"
                  defaultValue={pick(rowState(null), 'programId', '')}
                  aria-label="New program"
                >
                  <option value="">— none —</option>
                  {programs.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.code}
                    </option>
                  ))}
                </select>
              </td>
              <td className="num">
                <input
                  form="new-line"
                  name="sortOrder"
                  defaultValue={pick(
                    rowState(null),
                    'sortOrder',
                    String(grant.budgetLines.length + 1),
                  )}
                  className="!w-16 text-right"
                  inputMode="numeric"
                  aria-label="New sort order"
                />
              </td>
              <td>
                <button form="new-line" type="submit" className="btn btn-sm">
                  Add line
                </button>
              </td>
            </tr>
          </tbody>
          <tfoot>
            <tr>
              <th colSpan={2}>Total budgeted</th>
              <th className="num">{formatCents(total)}</th>
              <th colSpan={3} className="font-normal">
                Award {formatCents(grant.awardAmountCents)}
                {diff === 0 ? (
                  <span className="pill pill-ok ml-2">matches award</span>
                ) : (
                  <span className="pill pill-warn ml-2">
                    {diff > 0 ? 'over' : 'under'} award by {formatCents(Math.abs(diff))}
                  </span>
                )}
              </th>
            </tr>
          </tfoot>
        </table>
      </div>
    </>
  );
}
