import Link from 'next/link';
import { Card, DataTable, Money, NumTd, Th, TotalRow } from '@/components/ui';
import { formatPct1 } from '@/domain/money';
import { dimensionLabels } from '@/reports/params';
import { cellId } from '@/reports/pivot';
import { reportView } from '@/reports/view';
import type { ReportParams, Dimension } from '@/reports/params';
import type { Fact, ReportBudgetLine } from '@/reports/query';

export function ReportTable({
  facts,
  params,
  budgets = [],
  query,
  pageKey,
  links = true,
  columns,
  mapped = false,
}: {
  facts: Fact[];
  params: ReportParams;
  budgets?: ReportBudgetLine[];
  query: string;
  pageKey?: string;
  links?: boolean;
  columns?: string[];
  mapped?: boolean;
}) {
  const view = reportView(facts, params, budgets, pageKey, mapped, columns);
  const label = (dim: Dimension, key: string) => {
    const item = view.label(dim, key);
    return (
      <>
        {item.name}
        {item.code && item.code !== item.name ? (
          <small className="muted"> · {item.code}</small>
        ) : null}
      </>
    );
  };
  const href = (r: string, c: string) =>
    `/reports/lines?${query}&rowKey=${encodeURIComponent(r)}&colKey=${encodeURIComponent(c)}${pageKey === undefined ? '' : `&pageKey=${encodeURIComponent(pageKey)}`}`;
  return (
    <Card
      title={
        pageKey !== undefined ? (
          <>
            {dimensionLabels[params.page!]}: {label(params.page!, pageKey)}
          </>
        ) : undefined
      }
    >
      <DataTable
        caption={`${dimensionLabels[params.rows]} by ${dimensionLabels[params.cols]}`}
        stickyFirstColumn
      >
        <thead>
          <tr>
            <Th>
              {dimensionLabels[params.rows]} / {dimensionLabels[params.cols]}
            </Th>
            {view.cols.map((c) => (
              <Th num key={c}>
                {label(params.cols, c)} ($)
              </Th>
            ))}
            <Th num>Total ($)</Th>
            {view.showBudget && (
              <>
                <Th num>Budget ($)</Th>
                <Th num>Remaining ($)</Th>
                <Th num>Used (%)</Th>
              </>
            )}
          </tr>
        </thead>
        <tbody>
          {view.rows.map((r) => {
            const actual = view.actualFor(r);
            const budget = view.budgetFor(r);
            return (
              <tr key={r}>
                <Th scope="row">{label(params.rows, r)}</Th>
                {view.cols.map((c) => {
                  const n = view.data.cells.get(cellId(r, c)) ?? 0;
                  return (
                    <td className="num" data-cents={n} key={c}>
                      {links && n !== 0 ? (
                        <Link href={href(r, c)}>
                          <Money cents={n} />
                        </Link>
                      ) : (
                        <Money cents={n} />
                      )}
                    </td>
                  );
                })}
                <NumTd cents={actual} />
                {view.showBudget && (
                  <>
                    <NumTd cents={budget} />
                    <NumTd cents={budget - actual} />
                    <NumTd>{formatPct1(actual, budget)}</NumTd>
                  </>
                )}
              </tr>
            );
          })}
        </tbody>
        <tfoot>
          <TotalRow>
            <Th scope="row">Total</Th>
            {view.cols.map((c) => (
              <NumTd key={c} cents={view.columnTotal(c)} dollar />
            ))}
            <NumTd cents={view.actualTotal} dollar />
            {view.showBudget && (
              <>
                <NumTd cents={view.budgetTotal} dollar />
                <NumTd cents={view.budgetTotal - view.actualTotal} dollar />
                <NumTd>{formatPct1(view.actualTotal, view.budgetTotal)}</NumTd>
              </>
            )}
          </TotalRow>
        </tfoot>
      </DataTable>
    </Card>
  );
}
