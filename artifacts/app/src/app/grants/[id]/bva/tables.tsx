import {
  Card,
  DataTable,
  DateText,
  LinkCell,
  Money,
  Month,
  NumTd,
  ProgressBar,
  Td,
  Th,
  TotalRow,
} from '@/components/ui';
import { TERMS } from '@/copy/terms';
import type { YearMonth } from '@/domain/format';
import type { bvaData } from '@/services/bva';
import type { BudgetLineView, BudgetTree } from '@/services/grant-budget';
import type { WorkingRow, WorkingView } from '@/services/grant-workspace';
import type { BvaView } from './view';

type BvaGrant = Awaited<ReturnType<typeof bvaData>>['grants'][number];
type Run = Awaited<ReturnType<typeof bvaData>>['run'];

/* ------------------------------------------------------------------ Funder view */

/**
 * Funder view (budget as awarded): the funder's categories only, with funder totals. A grant
 * with no categories shows its working lines here and under the Internal view alike.
 */
export function FunderTable({ tree, date }: { tree: BudgetTree; date: Date }) {
  const remaining = tree.totals.budgetCents - tree.totals.chargedCents;
  const hasCategories = tree.categories.length > 0;
  return (
    <Card
      title={TERMS.funderView}
      action={
        <span className="muted text-sm">
          As of <DateText date={date} />
          {tree.runId ? '' : ' · no current run'}
        </span>
      }
    >
      <DataTable stickyFirstColumn>
        <thead>
          <tr>
            <Th>{hasCategories ? 'Funder category' : 'Budget line'}</Th>
            <Th num>Budget ($)</Th>
            <Th num>Charged ($)</Th>
            <Th num>Remaining ($)</Th>
            <Th num>Used</Th>
          </tr>
        </thead>
        <tbody>
          {tree.categories.map((c) => (
            <tr
              key={c.id}
              className="font-semibold"
              data-testid="funder-category"
              data-code={c.code}
            >
              <Th scope="row">{c.name}</Th>
              <NumTd cents={c.currentCents} data-testid="category-budget" />
              <NumTd cents={c.chargedCents} data-testid="category-charged" />
              <NumTd cents={c.currentCents - c.chargedCents} data-testid="category-remaining" />
              <NumTd>
                <ProgressBar
                  used={c.chargedCents}
                  budget={c.currentCents}
                  label={`${c.name} used`}
                />
              </NumTd>
            </tr>
          ))}
          {hasCategories && tree.loose.length > 0 && (
            <tr>
              <Th scope="row" colSpan={5}>
                Lines without a funder category
              </Th>
            </tr>
          )}
          {tree.loose.map((l) => (
            <FunderLineRow key={l.id} line={l} indent={hasCategories} />
          ))}
        </tbody>
        <tfoot>
          <TotalRow data-testid="funder-total">
            <Th scope="row">Total</Th>
            <NumTd cents={tree.totals.budgetCents} dollar zero="zero" data-testid="funder-budget" />
            <NumTd
              cents={tree.totals.chargedCents}
              dollar
              zero="zero"
              data-testid="funder-charged"
            />
            <NumTd cents={remaining} dollar zero="zero" data-testid="funder-remaining" />
            <NumTd>
              <ProgressBar
                used={tree.totals.chargedCents}
                budget={tree.totals.budgetCents}
                label="Total budget used"
              />
            </NumTd>
          </TotalRow>
        </tfoot>
      </DataTable>
    </Card>
  );
}

function FunderLineRow({ line: l, indent }: { line: BudgetLineView; indent: boolean }) {
  return (
    <tr data-testid="funder-line" data-code={l.code}>
      <Td className={indent ? 'pl-6' : undefined}>
        {l.name}
        <span className="muted block text-xs">{l.code}</span>
      </Td>
      <NumTd cents={l.currentCents} />
      <NumTd cents={l.chargedCents} data-testid="line-charged" />
      <NumTd cents={l.currentCents - l.chargedCents} />
      <NumTd>
        <ProgressBar used={l.chargedCents} budget={l.currentCents} label={`${l.name} used`} />
      </NumTd>
    </tr>
  );
}

/* ---------------------------------------------------------------- Internal view */

/**
 * Internal view (how we track it): working lines nested under their funder category, people
 * as their own lines, remaining per month left in the grant.
 */
export function InternalTable({
  tree,
  view,
  date,
}: {
  tree: BudgetTree;
  view: WorkingView;
  date: Date;
}) {
  return (
    <Card
      title={TERMS.internalView}
      action={
        <span className="muted text-sm">
          Report date <DateText date={date} />
        </span>
      }
    >
      <DataTable stickyFirstColumn>
        <thead>
          <tr>
            <Th>Line</Th>
            <Th num>Budget ($)</Th>
            <Th num>Charged ($)</Th>
            <Th num>Remaining ($)</Th>
            <Th num>Per month left ($)</Th>
          </tr>
        </thead>
        <tbody>
          {view.categories.map((c) => (
            <CategoryBlock key={c.category.id} block={c} />
          ))}
          {view.loose.map((r) => (
            <WorkingLineRow key={r.line.id} row={r} />
          ))}
        </tbody>
        <tfoot>
          <TotalRow data-testid="working-total-row">
            <Th scope="row">Total</Th>
            <NumTd cents={tree.totals.budgetCents} dollar zero="zero" data-testid="total-budget" />
            <NumTd
              cents={tree.totals.chargedCents}
              dollar
              zero="zero"
              data-testid="total-charged"
            />
            <NumTd
              cents={view.totalRemainingCents}
              dollar
              zero="zero"
              data-testid="total-remaining"
            />
            <PerMonth cents={view.totalPerMonthCents} testId="total-per-month" />
          </TotalRow>
        </tfoot>
      </DataTable>
      <p className="muted mt-2 text-xs">
        Months left = days from the report date to the grant end ÷ 30.44, to one decimal. Per month
        = remaining ÷ months left, rounded half-up. Blank once the grant has ended.
      </p>
    </Card>
  );
}

function PerMonth({ cents, testId }: { cents: number | null; testId?: string }) {
  return cents === null ? (
    <Td className="num muted" data-testid={testId} title="grant period has ended">
      —
    </Td>
  ) : (
    <NumTd cents={cents} data-testid={testId} />
  );
}

function WorkingLineRow({ row: r, indent }: { row: WorkingRow; indent?: boolean }) {
  return (
    <tr data-testid="working-line" data-code={r.line.code}>
      <Td className={indent ? 'pl-6' : undefined}>
        {r.line.name}
        <span className="muted block text-xs">{r.line.code}</span>
      </Td>
      <NumTd cents={r.line.currentCents} />
      <NumTd cents={r.line.chargedCents} data-testid="line-charged" />
      <NumTd cents={r.remainingCents} data-testid="line-remaining" />
      <PerMonth cents={r.perMonthCents} testId="line-per-month" />
    </tr>
  );
}

function CategoryBlock({ block: c }: { block: WorkingView['categories'][number] }) {
  return (
    <>
      <tr className="font-semibold" data-testid="working-category" data-code={c.category.code}>
        <Th scope="row">{c.category.name}</Th>
        <NumTd cents={c.category.currentCents} />
        <NumTd cents={c.category.chargedCents} data-testid="category-charged" />
        <NumTd cents={c.remainingCents} data-testid="category-remaining" />
        <PerMonth cents={c.perMonthCents} testId="category-per-month" />
      </tr>
      {c.rows.map((r) => (
        <WorkingLineRow key={r.line.id} row={r} indent />
      ))}
    </>
  );
}

/* -------------------------------------------------------------------- By month */

interface MonthRow {
  key: string;
  code: string;
  name: string;
  budgetCents: number;
  actual: number;
  monthly: Record<string, number>;
  /** Funder categories have no transactions of their own, so no drill-down. */
  drill: boolean;
  category: boolean;
}

/** Rows for the By-month table: funder categories (children summed) or the working lines. */
export function monthRows(grant: BvaGrant, tree: BudgetTree, view: BvaView): MonthRow[] {
  const leaves = grant.rows.filter((r) => r.kind !== 'funder_category');
  const leaf = (r: (typeof leaves)[number]): MonthRow => ({
    key: r.id,
    code: r.code,
    name: r.name,
    budgetCents: r.budgetCents,
    actual: r.actual,
    monthly: r.monthly,
    drill: true,
    category: false,
  });
  if (view === 'internal' || tree.categories.length === 0) return leaves.map(leaf);
  const byId = new Map(leaves.map((r) => [r.id, r]));
  const rows: MonthRow[] = tree.categories.map((c) => {
    const children = c.children.map((l) => byId.get(l.id)).filter((r) => r !== undefined);
    const monthly: Record<string, number> = {};
    for (const r of children)
      for (const [m, cents] of Object.entries(r.monthly)) monthly[m] = (monthly[m] ?? 0) + cents;
    return {
      key: c.id,
      code: c.code,
      name: c.name,
      budgetCents: c.currentCents,
      actual: children.reduce((n, r) => n + r.actual, 0),
      monthly,
      drill: false,
      category: true,
    };
  });
  for (const l of tree.loose) {
    const r = byId.get(l.id);
    if (r) rows.push(leaf(r));
  }
  return rows;
}

export function MonthlyTable({
  id,
  grant,
  tree,
  view,
  months,
  label,
  run,
}: {
  id: string;
  grant: BvaGrant;
  tree: BudgetTree;
  view: BvaView;
  months: YearMonth[];
  label: string;
  run: Run;
}) {
  const rows = monthRows(grant, tree, view);
  const future = (month: string) => month > label.slice(0, 7);
  const drill = (lineCode: string, month?: string) => {
    const q = new URLSearchParams({
      run: run?.id ?? '',
      grant: id,
      from: month ? `${month}-01` : grant.startDate.toISOString().slice(0, 10),
      to: month
        ? `${month}-${new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0)).getUTCDate()}`
        : label,
      rows: 'grantBudgetLine',
      cols: month ? 'month' : 'grant',
      rowKey: lineCode,
      colKey: month ?? grant.awardNumber ?? grant.name,
    });
    return `/reports/lines?${q}`;
  };
  return (
    <DataTable
      caption={`${TERMS.budgetVsActuals} by ${view === 'funder' ? 'funder category' : 'working line'} and month`}
      stickyFirstColumn
    >
      <thead>
        <tr>
          <Th>{view === 'funder' ? 'Funder category' : 'Working line'}</Th>
          <Th num>Budget ($)</Th>
          <Th num>Actual ($)</Th>
          <Th num>Remaining ($)</Th>
          <Th num>Used</Th>
          {months.map((m) => (
            <Th num className="whitespace-nowrap" key={m}>
              <Month ym={m} context={months} />
            </Th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr
            key={r.key}
            className={r.category ? 'font-semibold' : undefined}
            data-testid={r.category ? 'bva-month-category' : 'bva-month-line'}
            data-code={r.code}
          >
            <Td>
              {r.name}
              <span className="muted block text-sm">{r.code}</span>
            </Td>
            <NumTd cents={r.budgetCents} />
            <NumTd>
              {r.drill ? (
                <LinkCell href={drill(r.code)}>
                  <Money cents={r.actual} />
                </LinkCell>
              ) : (
                <Money cents={r.actual} />
              )}
            </NumTd>
            <NumTd cents={r.budgetCents - r.actual} />
            <NumTd>
              <ProgressBar used={r.actual} budget={r.budgetCents} label={`${r.name} budget used`} />
            </NumTd>
            {months.map((m) => (
              <NumTd key={m}>
                {future(m) ? (
                  <span>—</span>
                ) : r.drill ? (
                  <LinkCell href={drill(r.code, m)}>
                    <Money cents={r.monthly[m] ?? 0} />
                  </LinkCell>
                ) : (
                  <Money cents={r.monthly[m] ?? 0} />
                )}
              </NumTd>
            ))}
          </tr>
        ))}
        <TotalRow>
          <Th scope="row">Total</Th>
          <NumTd cents={grant.budget} dollar data-testid="bva-budget" />
          <NumTd cents={grant.actual} dollar data-testid="bva-actual" />
          <NumTd cents={grant.remaining} dollar />
          <NumTd>
            <ProgressBar used={grant.actual} budget={grant.budget} label="Total budget used" />
          </NumTd>
          {months.map((m) => (
            <NumTd key={m}>
              {future(m) ? (
                '—'
              ) : (
                <Money cents={rows.reduce((n, r) => n + (r.monthly[m] ?? 0), 0)} dollar />
              )}
            </NumTd>
          ))}
        </TotalRow>
      </tbody>
    </DataTable>
  );
}
