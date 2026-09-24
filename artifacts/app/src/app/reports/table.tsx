import { dimensionLabels } from '@/reports/params';
import Link from 'next/link';
import { formatCents } from '@/domain/money';
import { cellId, pivot } from '@/reports/pivot';
import type { ReportParams } from '@/reports/params';
import type { Fact } from '@/reports/query';

export function ReportTable({
  facts,
  params,
  query,
  pageKey,
  links = true,
}: {
  facts: Fact[];
  params: ReportParams;
  query: string;
  pageKey?: string;
  links?: boolean;
}) {
  const data = pivot(facts, {
    rows: params.rows,
    cols: params.cols,
    page: params.page,
    pageKey,
    zeros: params.zeros,
  });
  const href = (r: string, c: string) =>
    `/reports/lines?${query}&rowKey=${encodeURIComponent(r)}&colKey=${encodeURIComponent(c)}${pageKey === undefined ? '' : `&pageKey=${encodeURIComponent(pageKey)}`}`;
  return (
    <div className="card">
      {pageKey !== undefined ? (
        <h2>
          {dimensionLabels[params.page!]}: {pageKey}
        </h2>
      ) : null}
      <table>
        <thead>
          <tr>
            <th>
              {dimensionLabels[params.rows]} / {dimensionLabels[params.cols]}
            </th>
            {data.colKeys.map((c) => (
              <th className="num" key={c}>
                {c}
              </th>
            ))}
            <th className="num">Total</th>
          </tr>
        </thead>
        <tbody>
          {data.rowKeys.map((r) => (
            <tr key={r}>
              <th>{r}</th>
              {data.colKeys.map((c) => {
                const n = data.cells.get(cellId(r, c)) ?? 0;
                return (
                  <td className="num" key={c}>
                    {links && n !== 0 ? (
                      <Link href={href(r, c)}>{formatCents(n)}</Link>
                    ) : (
                      formatCents(n)
                    )}
                  </td>
                );
              })}
              <td className="num">{formatCents(data.rowTotals.get(r) ?? 0)}</td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr>
            <th>Total</th>
            {data.colKeys.map((c) => (
              <td className="num" key={c}>
                {formatCents(data.colTotals.get(c) ?? 0)}
              </td>
            ))}
            <td className="num">{formatCents(data.grandTotal)}</td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
}
