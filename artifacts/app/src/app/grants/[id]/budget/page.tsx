import Link from 'next/link';
import { notFound } from 'next/navigation';
import { PageHeader } from '@/components/page-header';
import { FormBanner } from '@/components/form';
import { Banner, DateText, Money, NumTd, StatusPill, Th } from '@/components/ui';
import { prisma } from '@/lib/db';
import { getOrgId } from '@/lib/org';
import { decodeFormState, pick, type FormState } from '@/lib/forms';
import { centsToDecimalString, formatCents } from '@/domain/money';
import { CATEGORY_KEYS, categoryLabel } from '@/domain/categories';
import { budgetTree, type BudgetLineView } from '@/services/grant-budget';
import {
  addRevisionAction,
  deleteBudgetLineAction,
  saveActivityAction,
  saveBudgetLineAction,
} from '../../actions';
import { GrantTabs } from '../tabs';

export const dynamic = 'force-dynamic';

const KIND_LABEL = {
  funder_category: 'Funder category',
  working_line: 'Working line',
  cell: 'Cell',
} as const;

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
  const grant = await prisma.grant.findFirst({ where: { id, orgId } });
  if (!grant) notFound();
  const [tree, programs] = await Promise.all([
    budgetTree(orgId, id),
    prisma.program.findMany({ where: { orgId, active: true }, orderBy: { code: 'asc' } }),
  ]);
  const state = decodeFormState(f);
  const workingTotal = tree.totals.workingCurrentCents;
  const diff = workingTotal - grant.awardAmountCents;
  const funderDiff = workingTotal - tree.totals.funderCents;
  // errors for a given row are prefixed with `<lineId>.`; new-row errors are unprefixed
  const rowErr = (lineId: string | null, field: string) =>
    state?.errors[lineId ? `${lineId}.${field}` : field];
  const rowState = (lineId: string | null): FormState | null =>
    lineId
      ? state?.values['$row'] === lineId
        ? state
        : null
      : state?.values['$row']
        ? null
        : state;
  const leaves = tree.all.filter((l) => l.kind !== 'funder_category');
  const categoryKeys = [...new Set([...CATEGORY_KEYS, ...tree.categoryKeys])];
  const cellAt = new Map(
    leaves
      .filter((l) => l.kind === 'cell' && l.activityId && l.categoryKey)
      .map((l) => [`${l.activityId}|${l.categoryKey}`, l]),
  );
  const ordered: BudgetLineView[] = [
    ...tree.loose,
    ...tree.categories.flatMap((c) => [c, ...c.children]),
  ];

  const lineRow = (bl: BudgetLineView) => {
    const s = rowState(bl.id);
    const isCategory = bl.kind === 'funder_category';
    return (
      <tr
        key={bl.id}
        data-line-code={bl.code}
        data-kind={bl.kind}
        className={isCategory ? 'bg-paper-2 font-semibold' : ''}
      >
        <td className={bl.parentId ? 'pl-8' : ''}>
          <form id={`edit-${bl.id}`} action={saveBudgetLineAction.bind(null, id, bl.id)}>
            <input type="hidden" name="$row" value={bl.id} />
            <input type="hidden" name="kind" value={bl.kind} />
            <input type="hidden" name="activityId" value={bl.activityId ?? ''} />
            <input type="hidden" name="categoryKey" value={bl.categoryKey ?? ''} />
            <input
              name="code"
              defaultValue={pick(s, 'code', bl.code)}
              className="!w-24"
              aria-label="Code"
            />
          </form>
          {rowErr(bl.id, 'code') ? <p className="field-error">{rowErr(bl.id, 'code')}</p> : null}
        </td>
        <td>
          <input
            form={`edit-${bl.id}`}
            name="name"
            defaultValue={pick(s, 'name', bl.name)}
            aria-label="Name"
          />
          <span className="muted ml-1 text-xs">
            {KIND_LABEL[bl.kind]}
            {bl.kind === 'cell'
              ? ` · ${tree.activities.find((a) => a.id === bl.activityId)?.name ?? '?'} / ${categoryLabel(bl.categoryKey)}`
              : ''}
          </span>
          {rowErr(bl.id, 'name') ? <p className="field-error">{rowErr(bl.id, 'name')}</p> : null}
        </td>
        <td>
          {isCategory ? (
            <span className="muted">—</span>
          ) : (
            <select
              form={`edit-${bl.id}`}
              name="parentId"
              defaultValue={pick(s, 'parentId', bl.parentId ?? '')}
              aria-label="Funder category"
            >
              <option value="">— none —</option>
              {tree.categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.code}
                </option>
              ))}
            </select>
          )}
          {rowErr(bl.id, 'parentId') ? (
            <p className="field-error">{rowErr(bl.id, 'parentId')}</p>
          ) : null}
        </td>
        <td className="num">
          <input
            form={`edit-${bl.id}`}
            name="budget"
            defaultValue={pick(s, 'budget', centsToDecimalString(bl.originalCents))}
            className="!w-32 text-right"
            inputMode="decimal"
            aria-label="Budget"
          />
          {rowErr(bl.id, 'budget') ? (
            <p className="field-error">{rowErr(bl.id, 'budget')}</p>
          ) : null}
        </td>
        <NumTd cents={bl.revisionCents} />
        {isCategory ? (
          <td className="num" data-cents={bl.currentCents}>
            <Money cents={bl.currentCents} />
            {bl.childrenCurrentCents !== bl.currentCents ? (
              <span className="block text-xs font-normal">
                lines <Money cents={bl.childrenCurrentCents} />{' '}
                <StatusPill tone="warn">
                  {bl.childrenCurrentCents > bl.currentCents ? 'over' : 'under'} by{' '}
                  {formatCents(Math.abs(bl.childrenCurrentCents - bl.currentCents))}
                </StatusPill>
              </span>
            ) : null}
          </td>
        ) : (
          <NumTd cents={bl.currentCents} />
        )}
        <td className="num" data-testid="spent" data-cents={bl.spentCents}>
          <Money cents={bl.spentCents} />
          {bl.effortCents !== 0 ? (
            <span className="muted block text-xs" data-effort-cents={bl.effortCents}>
              + effort {formatCents(bl.effortCents)}
            </span>
          ) : null}
        </td>
        <td>
          {isCategory ? null : (
            <select
              form={`edit-${bl.id}`}
              name="programId"
              defaultValue={pick(s, 'programId', bl.programId ?? '')}
              aria-label="Program"
            >
              <option value="">— none —</option>
              {programs.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.code}
                </option>
              ))}
            </select>
          )}
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
          <form action={deleteBudgetLineAction.bind(null, id, bl.id)} className="inline">
            <button type="submit" className="btn btn-danger btn-sm">
              Delete
            </button>
          </form>
        </td>
      </tr>
    );
  };

  const newState = rowState(null);
  const revErr = (field: string) => state?.errors[`revision.${field}`];
  const actErr = (activityId: string | null, field: string) =>
    state?.errors[activityId ? `activity.${activityId}.${field}` : `activity.${field}`];

  return (
    <>
      <PageHeader
        title={`${grant.name} · budget`}
        subtitle="Two levels: the funder's categories, and the working lines or activity × category cells nested under them. Grant rules and decisions assign spending onto working lines and cells."
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
      {tree.categories.length > 0 && funderDiff !== 0 ? (
        <Banner tone="warn">
          <span data-testid="funder-warning">
            Working lines total <Money cents={workingTotal} /> which is{' '}
            {funderDiff > 0 ? 'over' : 'under'} the funder budget of{' '}
            <Money cents={tree.totals.funderCents} /> by{' '}
            <Money cents={Math.abs(funderDiff)} className="font-semibold" />.
          </span>
        </Banner>
      ) : null}
      {tree.runId === null ? (
        <p className="muted mb-2 text-sm">Spent figures appear after the first compute run.</p>
      ) : null}

      <div className="card mb-4 max-w-full overflow-x-auto">
        <table data-testid="budget-tree">
          <thead>
            <tr>
              <th>Code</th>
              <th>Name</th>
              <th>Funder category</th>
              <th className="num">Original ($)</th>
              <th className="num">Revisions ($)</th>
              <th className="num">Current ($)</th>
              <th className="num">Spent ($)</th>
              <th>Program</th>
              <th className="num">Order</th>
              <th className="relative">
                <span className="sr-only">Actions</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {ordered.map(lineRow)}
            <tr className="bg-paper-2">
              <td>
                <form id="new-line" action={saveBudgetLineAction.bind(null, id, null)}>
                  <input
                    name="code"
                    placeholder="CODE"
                    defaultValue={pick(newState, 'code', '')}
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
                  defaultValue={pick(newState, 'name', '')}
                  aria-label="New name"
                />
                <select
                  form="new-line"
                  name="kind"
                  defaultValue={pick(newState, 'kind', 'working_line')}
                  aria-label="New kind"
                  className="mt-1"
                >
                  <option value="working_line">Working line</option>
                  <option value="funder_category">Funder category</option>
                  <option value="cell">Cell (activity × category)</option>
                </select>
                {rowErr(null, 'name') ? (
                  <p className="field-error">{rowErr(null, 'name')}</p>
                ) : null}
                {rowErr(null, 'kind') ? (
                  <p className="field-error">{rowErr(null, 'kind')}</p>
                ) : null}
              </td>
              <td>
                <select
                  form="new-line"
                  name="parentId"
                  defaultValue={pick(newState, 'parentId', '')}
                  aria-label="New funder category"
                >
                  <option value="">— none —</option>
                  {tree.categories.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.code}
                    </option>
                  ))}
                </select>
                {tree.activities.length > 0 ? (
                  <>
                    <select
                      form="new-line"
                      name="activityId"
                      defaultValue={pick(newState, 'activityId', '')}
                      aria-label="New cell activity"
                      className="mt-1"
                    >
                      <option value="">— activity (cells) —</option>
                      {tree.activities.map((a) => (
                        <option key={a.id} value={a.id}>
                          {a.name}
                        </option>
                      ))}
                    </select>
                    <select
                      form="new-line"
                      name="categoryKey"
                      defaultValue={pick(newState, 'categoryKey', '')}
                      aria-label="New cell category"
                      className="mt-1"
                    >
                      <option value="">— category (cells) —</option>
                      {categoryKeys.map((k) => (
                        <option key={k} value={k}>
                          {categoryLabel(k)}
                        </option>
                      ))}
                    </select>
                  </>
                ) : null}
                {rowErr(null, 'parentId') ? (
                  <p className="field-error">{rowErr(null, 'parentId')}</p>
                ) : null}
                {rowErr(null, 'activityId') ? (
                  <p className="field-error">{rowErr(null, 'activityId')}</p>
                ) : null}
                {rowErr(null, 'categoryKey') ? (
                  <p className="field-error">{rowErr(null, 'categoryKey')}</p>
                ) : null}
              </td>
              <td className="num">
                <input
                  form="new-line"
                  name="budget"
                  placeholder="0.00"
                  defaultValue={pick(newState, 'budget', '')}
                  className="!w-32 text-right"
                  inputMode="decimal"
                  aria-label="New budget"
                />
                {rowErr(null, 'budget') ? (
                  <p className="field-error">{rowErr(null, 'budget')}</p>
                ) : null}
              </td>
              <td className="num muted">—</td>
              <td className="num muted">—</td>
              <td className="num muted">—</td>
              <td>
                <select
                  form="new-line"
                  name="programId"
                  defaultValue={pick(newState, 'programId', '')}
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
                  defaultValue={pick(newState, 'sortOrder', String(tree.all.length + 1))}
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
              <th colSpan={3}>Total working lines (current)</th>
              <th className="num" data-cents={tree.totals.workingOriginalCents}>
                {formatCents(tree.totals.workingOriginalCents)}
              </th>
              <th className="num">
                <Money cents={workingTotal - tree.totals.workingOriginalCents} />
              </th>
              <th className="num" data-testid="working-total" data-cents={workingTotal}>
                {formatCents(workingTotal)}
              </th>
              <th className="num" data-cents={tree.totals.spentCents}>
                {formatCents(tree.totals.spentCents)}
                {tree.totals.effortCents !== 0 ? (
                  <span
                    className="muted block text-xs font-normal"
                    data-effort-cents={tree.totals.effortCents}
                    data-charged-cents={tree.totals.chargedCents}
                  >
                    + effort {formatCents(tree.totals.effortCents)} = charged{' '}
                    {formatCents(tree.totals.chargedCents)}
                  </span>
                ) : null}
              </th>
              <th colSpan={3} className="font-normal">
                Award {formatCents(grant.awardAmountCents)}
                {diff === 0 ? (
                  <span className="pill pill-ok ml-2">matches award</span>
                ) : (
                  <span className="pill pill-warn ml-2">
                    {diff > 0 ? 'over' : 'under'} award by {formatCents(Math.abs(diff))}
                  </span>
                )}
                {tree.categories.length > 0 ? (
                  <span className="ml-2">
                    Funder categories{' '}
                    <span data-testid="funder-total" data-cents={tree.totals.funderCents}>
                      {formatCents(tree.totals.funderCents)}
                    </span>
                  </span>
                ) : null}
              </th>
            </tr>
          </tfoot>
        </table>
      </div>

      <div className="card mb-4" id="activities">
        <h2>Activities</h2>
        <p className="muted text-sm">
          Programs the funder counts (activity × category grants). Aliases are the keywords activity
          rules look for; matching ignores case and apostrophes.
        </p>
        <div className="max-w-full overflow-x-auto">
          <table data-testid="activities">
            <thead>
              <tr>
                <th>Name</th>
                <th>Aliases (comma separated)</th>
                <th className="num">Planned</th>
                <th className="num">Completed</th>
                <th className="num">Order</th>
                <th className="relative">
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {tree.activities.map((a) => (
                <tr key={a.id}>
                  <td>
                    <form id={`activity-${a.id}`} action={saveActivityAction.bind(null, id, a.id)}>
                      <input name="name" defaultValue={a.name} aria-label="Activity name" />
                    </form>
                    {actErr(a.id, 'name') ? (
                      <p className="field-error">{actErr(a.id, 'name')}</p>
                    ) : null}
                  </td>
                  <td>
                    <input
                      form={`activity-${a.id}`}
                      name="aliases"
                      defaultValue={a.aliases.join(', ')}
                      aria-label="Aliases"
                      className="!w-64"
                    />
                  </td>
                  <td className="num">
                    <input
                      form={`activity-${a.id}`}
                      name="plannedCount"
                      defaultValue={String(a.plannedCount)}
                      className="!w-16 text-right"
                      inputMode="numeric"
                      aria-label="Planned count"
                    />
                  </td>
                  <td className="num">
                    <input
                      form={`activity-${a.id}`}
                      name="completedCount"
                      defaultValue={String(a.completedCount)}
                      className="!w-16 text-right"
                      inputMode="numeric"
                      aria-label="Completed count"
                    />
                  </td>
                  <td className="num">
                    <input
                      form={`activity-${a.id}`}
                      name="sortOrder"
                      defaultValue={String(a.sortOrder)}
                      className="!w-16 text-right"
                      inputMode="numeric"
                      aria-label="Activity order"
                    />
                  </td>
                  <td>
                    <button form={`activity-${a.id}`} type="submit" className="btn btn-sm">
                      Save
                    </button>
                  </td>
                </tr>
              ))}
              <tr className="bg-paper-2">
                <td>
                  <form id="new-activity" action={saveActivityAction.bind(null, id, null)}>
                    <input
                      name="name"
                      placeholder="Activity name"
                      defaultValue={pick(state, 'name', '')}
                      aria-label="New activity name"
                    />
                  </form>
                  {actErr(null, 'name') ? (
                    <p className="field-error">{actErr(null, 'name')}</p>
                  ) : null}
                </td>
                <td>
                  <input
                    form="new-activity"
                    name="aliases"
                    placeholder="keyword, another keyword"
                    aria-label="New aliases"
                    className="!w-64"
                  />
                </td>
                <td className="num">
                  <input
                    form="new-activity"
                    name="plannedCount"
                    defaultValue="0"
                    className="!w-16 text-right"
                    inputMode="numeric"
                    aria-label="New planned count"
                  />
                </td>
                <td className="num">
                  <input
                    form="new-activity"
                    name="completedCount"
                    defaultValue="0"
                    className="!w-16 text-right"
                    inputMode="numeric"
                    aria-label="New completed count"
                  />
                </td>
                <td className="num">
                  <input
                    form="new-activity"
                    name="sortOrder"
                    defaultValue={String((tree.activities.length + 1) * 10)}
                    className="!w-16 text-right"
                    inputMode="numeric"
                    aria-label="New activity order"
                  />
                </td>
                <td>
                  <button form="new-activity" type="submit" className="btn btn-sm">
                    Add activity
                  </button>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      {tree.activities.length > 0 ? (
        <div className="card mb-4" id="cells">
          <h2>Activity × category grid</h2>
          <p className="muted text-sm">
            Current budget over spent to date for each cell. Add cells with the “Cell” kind in the
            budget table above.
          </p>
          <div className="max-w-full overflow-x-auto">
            <table data-testid="cell-grid">
              <thead>
                <tr>
                  <th>Activity</th>
                  <th className="num">Done / planned</th>
                  {categoryKeys.map((k) => (
                    <Th key={k} num>
                      {categoryLabel(k)}
                    </Th>
                  ))}
                  <th className="num">Activity total ($)</th>
                </tr>
              </thead>
              <tbody>
                {tree.activities.map((a) => {
                  const cells = categoryKeys.map((k) => cellAt.get(`${a.id}|${k}`) ?? null);
                  const spent = cells.reduce((s, c) => s + (c?.spentCents ?? 0), 0);
                  const effort = cells.reduce((s, c) => s + (c?.effortCents ?? 0), 0);
                  const budget = cells.reduce((s, c) => s + (c?.currentCents ?? 0), 0);
                  return (
                    <tr key={a.id} data-activity={a.name}>
                      <th scope="row">{a.name}</th>
                      <td className="num">
                        {a.completedCount} / {a.plannedCount}
                      </td>
                      {cells.map((c, i) => (
                        <td
                          key={categoryKeys[i]}
                          className="num"
                          data-category={categoryKeys[i]}
                          data-cents={c ? c.spentCents : undefined}
                        >
                          {c ? (
                            <>
                              <span className="muted block text-xs">
                                budget <Money cents={c.currentCents} />
                              </span>
                              <span className="block">
                                spent <Money cents={c.spentCents} />
                              </span>
                              {c.effortCents !== 0 ? (
                                <span className="block" data-effort-cents={c.effortCents}>
                                  effort <Money cents={c.effortCents} />
                                </span>
                              ) : null}
                            </>
                          ) : (
                            <span className="muted">·</span>
                          )}
                        </td>
                      ))}
                      <td className="num">
                        <span className="muted block text-xs">
                          budget <Money cents={budget} />
                        </span>
                        <span className="block">
                          spent <Money cents={spent} />
                        </span>
                        {effort !== 0 ? (
                          <span className="block" data-effort-cents={effort}>
                            effort <Money cents={effort} />
                          </span>
                        ) : null}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}

      <div className="card mb-4" id="revisions">
        <h2>Budget revisions</h2>
        <p className="muted text-sm">
          A revision moves budget on a dated, noted entry. The original budget is never overwritten;
          the current budget is original + revisions.
        </p>
        <form action={addRevisionAction.bind(null, id)} className="grid-form" id="new-revision">
          <div>
            <label htmlFor="rev-line">Budget line</label>
            <select
              id="rev-line"
              name="budgetLineId"
              defaultValue={pick(state, 'budgetLineId', '')}
              required
            >
              <option value="">Select a working line or cell</option>
              {leaves.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.code} — {l.name}
                </option>
              ))}
            </select>
            {revErr('budgetLineId') ? (
              <p className="field-error">{revErr('budgetLineId')}</p>
            ) : null}
          </div>
          <div>
            <label htmlFor="rev-counterpart">
              Counterpart (optional, moves the opposite amount)
            </label>
            <select
              id="rev-counterpart"
              name="counterpartLineId"
              defaultValue={pick(state, 'counterpartLineId', '')}
            >
              <option value="">— none —</option>
              {leaves.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.code} — {l.name}
                </option>
              ))}
            </select>
            {revErr('counterpartLineId') ? (
              <p className="field-error">{revErr('counterpartLineId')}</p>
            ) : null}
          </div>
          <div>
            <label htmlFor="rev-date">Date</label>
            <input
              id="rev-date"
              name="date"
              type="date"
              defaultValue={pick(state, 'date', '')}
              required
            />
            {revErr('date') ? <p className="field-error">{revErr('date')}</p> : null}
          </div>
          <div>
            <label htmlFor="rev-delta">Amount (+ increases, − decreases)</label>
            <input
              id="rev-delta"
              name="delta"
              inputMode="decimal"
              placeholder="1,400.00"
              defaultValue={pick(state, 'delta', '')}
              required
            />
            {revErr('delta') ? <p className="field-error">{revErr('delta')}</p> : null}
            {revErr('deltaCents') ? <p className="field-error">{revErr('deltaCents')}</p> : null}
          </div>
          <div className="md:col-span-2">
            <label htmlFor="rev-note">Note</label>
            <input id="rev-note" name="note" defaultValue={pick(state, 'note', '')} required />
            {revErr('note') ? <p className="field-error">{revErr('note')}</p> : null}
          </div>
          <div>
            <button type="submit" className="btn">
              Record revision
            </button>
          </div>
        </form>
        <h3 className="mt-4">History</h3>
        {tree.revisions.length === 0 ? (
          <p className="muted text-sm">No revisions yet.</p>
        ) : (
          <div className="max-w-full overflow-x-auto">
            <table data-testid="revision-history">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Line</th>
                  <th className="num">Change ($)</th>
                  <th>Counterpart</th>
                  <th>Note</th>
                  <th>By</th>
                </tr>
              </thead>
              <tbody>
                {tree.revisions.map((r) => (
                  <tr key={r.id} data-revision-line={r.budgetLineCode}>
                    <td>
                      <DateText date={r.date} />
                    </td>
                    <td>{r.budgetLineCode}</td>
                    <NumTd cents={r.deltaCents} />
                    <td>{r.counterpartCode ?? '—'}</td>
                    <td>{r.note}</td>
                    <td className="muted">{r.actor}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  );
}
