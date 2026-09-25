import { notFound } from 'next/navigation';
import {
  Card,
  DataTable,
  EmptyState,
  Footnote,
  FootnoteMark,
  Money,
  NumTd,
  PageHeader,
  Period,
  Td,
  Th,
  TotalRow,
} from '@/components/ui';
import { getOrgId } from '@/lib/org';
import { budgetTree } from '@/services/grant-budget';
import { activityGrid, grantHeader, type GridCell } from '@/services/grant-workspace';
import { GrantTabs } from '../tabs';

export const dynamic = 'force-dynamic';

/**
 * Activity × funder-category grid. Every cell shows budget / charged / remaining
 * and, while occurrences remain, remaining per remaining occurrence. An
 * over-budget cell stays red on its own row; column totals are plain sums.
 */
export default async function ActivityGridPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const orgId = await getOrgId();
  const grant = await grantHeader(orgId, id);
  if (!grant) notFound();
  const tree = await budgetTree(orgId, id);
  const grid = activityGrid(tree);
  // A column that names two kinds of cost ("Food & Supplies") is still one funder budget line.
  const combined = grid.columns.filter((c) => /\s(&|and)\s/i.test(c.name));
  return (
    <>
      <PageHeader
        title={grant.name}
        subtitle={
          <>
            {grant.funder} · <Period from={grant.startDate} to={grant.endDate} />
          </>
        }
      />
      <GrantTabs id={id} active="activity" />
      {grid.rows.length === 0 ? (
        <EmptyState title="No activities" hint="This grant has no activities with budget cells." />
      ) : (
        <Card title="Activity grid">
          <DataTable stickyFirstColumn>
            <thead>
              <tr>
                <Th>Activity</Th>
                <Th num>Planned / done</Th>
                {grid.columns.map((c) => (
                  <Th key={c.id} num>
                    {c.name}
                    {combined.includes(c) && <FootnoteMark id="fn-combined" />}
                  </Th>
                ))}
                <Th num>Row total</Th>
              </tr>
            </thead>
            <tbody>
              {grid.rows.map((r) => (
                <tr key={r.activityId} data-testid="activity-row" data-activity={r.name}>
                  <Th scope="row">{r.name}</Th>
                  <Td className="num">
                    <span data-testid="counts">
                      {r.plannedCount} / {r.completedCount}
                    </span>
                    <span className="muted block text-xs">
                      {Math.max(0, r.plannedCount - r.completedCount)} left
                    </span>
                  </Td>
                  {r.cells.map((c, i) => (
                    <Cell key={c.categoryId} cell={c} code={grid.columns[i]!.code} />
                  ))}
                  <NumTd cents={r.totalRemainingCents} data-testid="row-remaining" />
                </tr>
              ))}
              <TotalRow data-testid="grid-totals" className="category-total">
                <Th scope="row" colSpan={2}>
                  Remaining by category
                  <FootnoteMark id="fn-net" mark="²" />
                </Th>
                {grid.totals.map((t, i) => (
                  <NumTd
                    key={t.categoryId}
                    cents={t.remainingCents}
                    dollar
                    data-testid="column-remaining"
                    data-code={grid.columns[i]!.code}
                  />
                ))}
                <NumTd
                  cents={grid.totals.reduce((s, t) => s + t.remainingCents, 0)}
                  dollar
                  data-testid="grid-remaining"
                />
              </TotalRow>
            </tbody>
          </DataTable>
          <p className="muted mt-2 text-xs">
            Each cell: budget · charged · <strong>remaining</strong>, then remaining ÷ occurrences
            left (planned − completed), rounded half-up; an em dash when none are left. Over-budget
            cells stay on their own row and are never netted against another activity.
          </p>
          {combined.length > 0 && (
            <Footnote id="fn-combined">
              one funder budget line — {combined.map((c) => c.name).join(', ')} is a single line in
              the award, so it stays a single column.
            </Footnote>
          )}
          <Footnote id="fn-net" mark="²">
            net of rows over and under budget.
          </Footnote>
          {grid.unassignedCells.length > 0 && (
            <p className="muted mt-1 text-xs">
              {grid.unassignedCells.length} cell(s) have no funder category and are not shown.
            </p>
          )}
        </Card>
      )}
    </>
  );
}

function Cell({ cell: c, code }: { cell: GridCell; code: string }) {
  if (c.budgetCents === 0 && c.chargedCents === 0)
    return (
      <Td className="num muted" data-testid="grid-cell" data-code={code} data-empty="1">
        —
      </Td>
    );
  return (
    <Td className="num" data-testid="grid-cell" data-code={code} data-over={c.overBudget ? '1' : '0'}>
      <span className="muted block text-xs">
        <Money cents={c.budgetCents} /> · <Money cents={c.chargedCents} />
      </span>
      <span className="block font-semibold">
        <Money cents={c.remainingCents} className="cell-remaining" />
        {c.overBudget && <span className="chip">over</span>}
      </span>
      <span className="block text-xs" data-testid="per-occurrence">
        {c.perOccurrenceCents === null ? (
          <span className="muted" title="none remaining">
            —
          </span>
        ) : (
          <>
            <Money cents={c.perOccurrenceCents} className="cell-per-occurrence" /> / occurrence
          </>
        )}
      </span>
    </Td>
  );
}
