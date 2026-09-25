import Link from 'next/link';
import { Fragment } from 'react';
import { Card, DataTable, Money, NumTd, Th, TotalRow } from '@/components/ui';
import { formatMoney } from '@/domain/format';
import { formatPct1 } from '@/domain/money';
import { dimensionLabels } from '@/reports/params';
import { cellId } from '@/reports/pivot';
import type { ReportBlock, ReportGroup, ReportSection, ReportView } from '@/reports/view';
import type { ReportParams, Dimension } from '@/reports/params';

function Label({ view, dim, itemKey }: { view: ReportView; dim: Dimension; itemKey: string }) {
  const item = view.label(dim, itemKey);
  return (
    <>
      {item.name}
      {item.code && item.code !== item.name ? (
        <small className="muted"> · {item.code}</small>
      ) : null}
    </>
  );
}

/** Subtle mapping-status note under a program row in the one-table layout. */
function rowAnnotation(view: ReportView, row: string, params: ReportParams) {
  if (params.rows !== 'program') return null;
  const category = view.categoryOf(row);
  if (category === 'management_general' || category === 'fundraising') return 'Non-grant';
  const unmapped = view.unmappedFor(row);
  return unmapped
    ? `incl. ${formatMoney(unmapped, { dollar: true })} not charged to any grant`
    : null;
}

export function ReportTable({
  section,
  block,
  params,
  query,
  links = true,
}: {
  section: ReportSection;
  block: ReportBlock;
  params: ReportParams;
  query: string;
  links?: boolean;
}) {
  const { total, pageKey } = block;
  const href = (r: string, c: string, group: ReportGroup['kind']) =>
    `/reports/lines?${query}&rowKey=${encodeURIComponent(r)}&colKey=${encodeURIComponent(c)}${
      pageKey === undefined ? '' : `&pageKey=${encodeURIComponent(pageKey)}`
    }${group === 'all' ? '' : `&group=${group}`}`;
  const span = total.cols.length + 2 + (total.showBudget ? 3 : 0);
  const annotate = section.kind === 'single' && !block.grouped;
  return (
    <Card
      className={section.mapped ? undefined : 'card-unmapped'}
      title={
        pageKey !== undefined ? (
          <>
            {dimensionLabels[params.page!]}:{' '}
            <Label view={total} dim={params.page!} itemKey={pageKey} />
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
            {total.cols.map((c) => (
              <Th num key={c}>
                <Label view={total} dim={params.cols} itemKey={c} /> ($)
              </Th>
            ))}
            <Th num>Total ($)</Th>
            {total.showBudget && (
              <>
                <Th num>Budget ($)</Th>
                <Th num>Remaining ($)</Th>
                <Th num>Used (%)</Th>
              </>
            )}
          </tr>
        </thead>
        <tbody>
          {block.groups.map((group) => {
            const view = group.view;
            return (
              <Fragment key={group.kind}>
                {block.grouped && (
                  <tr className="row-group">
                    <th scope="rowgroup" colSpan={span}>
                      {group.heading}
                    </th>
                  </tr>
                )}
                {view.rows.map((r) => {
                  const actual = view.actualFor(r);
                  const budget = view.budgetFor(r);
                  const note = annotate ? rowAnnotation(view, r, params) : null;
                  return (
                    <tr key={r}>
                      <Th scope="row">
                        <Label view={view} dim={params.rows} itemKey={r} />
                        {note ? <small className="row-note">{note}</small> : null}
                      </Th>
                      {total.cols.map((c) => {
                        const n = view.data.cells.get(cellId(r, c)) ?? 0;
                        return (
                          <td className="num" data-cents={n} key={c}>
                            {links && n !== 0 ? (
                              <Link href={href(r, c, group.kind)}>
                                <Money cents={n} />
                              </Link>
                            ) : (
                              <Money cents={n} />
                            )}
                          </td>
                        );
                      })}
                      <NumTd cents={actual} />
                      {total.showBudget && (
                        <>
                          <NumTd cents={budget} />
                          <NumTd cents={budget - actual} />
                          <NumTd>{formatPct1(actual, budget)}</NumTd>
                        </>
                      )}
                    </tr>
                  );
                })}
                {block.grouped && (
                  <tr className="subtotal">
                    <Th scope="row">Subtotal</Th>
                    {total.cols.map((c) => (
                      <NumTd key={c} cents={view.columnTotal(c)} />
                    ))}
                    <NumTd cents={view.actualTotal} />
                    {total.showBudget && (
                      <>
                        <NumTd cents={view.budgetTotal} />
                        <NumTd cents={view.budgetTotal - view.actualTotal} />
                        <NumTd>{formatPct1(view.actualTotal, view.budgetTotal)}</NumTd>
                      </>
                    )}
                  </tr>
                )}
              </Fragment>
            );
          })}
        </tbody>
        <tfoot>
          <TotalRow>
            <Th scope="row">Total</Th>
            {total.cols.map((c) => (
              <NumTd key={c} cents={total.columnTotal(c)} dollar />
            ))}
            <NumTd cents={total.actualTotal} dollar data-grand-total="" />
            {total.showBudget && (
              <>
                <NumTd cents={total.budgetTotal} dollar />
                <NumTd cents={total.budgetTotal - total.actualTotal} dollar />
                <NumTd>{formatPct1(total.actualTotal, total.budgetTotal)}</NumTd>
              </>
            )}
          </TotalRow>
        </tfoot>
      </DataTable>
    </Card>
  );
}

export function ReportSections({
  sections,
  params,
  query,
  links = true,
}: {
  sections: ReportSection[];
  params: ReportParams;
  query: string;
  links?: boolean;
}) {
  return sections.map((section) => (
    <section
      key={section.kind}
      aria-label={section.heading || 'Grant expenses'}
      className={section.mapped ? undefined : 'section-unmapped'}
    >
      {section.heading && <h2>{section.heading}</h2>}
      {section.blocks.map((block) => (
        <ReportTable
          key={block.pageKey ?? '_'}
          section={section}
          block={block}
          params={params}
          query={query}
          links={links}
        />
      ))}
    </section>
  ));
}
