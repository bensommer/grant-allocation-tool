import ExcelJS from 'exceljs';
import { centsToDecimalString, formatPct1 } from '@/domain/money';
import { cellId } from './pivot';
import { dimensionLabels, type ReportParams } from './params';
import type { Fact, ReportBudgetLine } from './query';
import {
  budgetColumnsNote,
  displayLabel,
  reportSections,
  splitByMapping,
  type ReportSection,
  type ReportView,
} from './view';

/** Every table of the report in render order, with the section it belongs to. */
export function exportTables(facts: Fact[], p: ReportParams, budgets: ReportBudgetLine[]) {
  return reportSections(facts, p, budgets).flatMap((section) =>
    section.blocks.map((block) => ({ section, block })),
  );
}

export const sectionTitle = (section: ReportSection, p: ReportParams) =>
  section.heading ||
  (section.kind === 'single'
    ? `${dimensionLabels[p.rows]} × ${dimensionLabels[p.cols]}`
    : 'Grant expenses');

const money = (cents: number) => centsToDecimalString(cents);
const numericRow = (view: ReportView, cells: number[], actual: number, budget: number) => [
  ...cells.map(money),
  money(actual),
  ...(view.showBudget ? [money(budget), money(budget - actual), formatPct1(actual, budget)] : []),
];

export function csvReport(facts: Fact[], p: ReportParams, budgets: ReportBudgetLine[] = []) {
  const quote = (v: string | number) => `"${String(v).replaceAll('"', '""')}"`;
  const lines: (string | number)[][] = [];
  if (budgetColumnsNote(p))
    lines.push(['Budget columns are shown when the report is broken by grant or not at all']);
  for (const { section, block } of exportTables(facts, p, budgets)) {
    const { total, pageKey } = block;
    lines.push([
      sectionTitle(section, p),
      pageKey === undefined ? '' : displayLabel(total.label(p.page!, pageKey)),
    ]);
    lines.push([
      dimensionLabels[p.rows],
      ...total.cols.map((c) => `${displayLabel(total.label(p.cols, c))} ($)`),
      'Total ($)',
      ...(total.showBudget ? ['Budget ($)', 'Remaining ($)', 'Used (%)'] : []),
    ]);
    for (const group of block.groups) {
      const view = group.view;
      if (block.grouped) lines.push([group.heading!]);
      for (const row of view.rows)
        lines.push([
          displayLabel(view.label(p.rows, row)),
          ...numericRow(
            total,
            total.cols.map((c) => view.data.cells.get(cellId(row, c)) ?? 0),
            view.actualFor(row),
            view.budgetFor(row),
          ),
        ]);
      if (block.grouped)
        lines.push([
          'Subtotal',
          ...numericRow(
            total,
            total.cols.map((c) => view.columnTotal(c)),
            view.actualTotal,
            view.budgetTotal,
          ),
        ]);
    }
    lines.push([
      'Total',
      ...numericRow(
        total,
        total.cols.map((c) => total.columnTotal(c)),
        total.actualTotal,
        total.budgetTotal,
      ),
    ]);
    lines.push([]);
  }
  return lines.map((row) => row.map(quote).join(',')).join('\r\n') + '\r\n';
}

export async function xlsxReport(
  facts: Fact[],
  p: ReportParams,
  runId: string,
  budgets: ReportBudgetLine[] = [],
) {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('Report');
  sheet.columns = [{ width: 37 }, ...Array.from({ length: 40 }, () => ({ width: 24 }))];
  if (budgetColumnsNote(p))
    sheet.addRow(['Budget columns are shown when the report is broken by grant or not at all']);
  for (const { section, block } of exportTables(facts, p, budgets)) {
    const { total, pageKey } = block;
    const width = total.cols.length;
    const letter = (i: number) => sheet.getColumn(i).letter;
    const numericColumns = width + (total.showBudget ? 4 : 2);
    sheet.addRow([
      sectionTitle(section, p),
      pageKey === undefined ? '' : displayLabel(total.label(p.page!, pageKey)),
    ]);
    sheet.lastRow!.font = { bold: true };
    sheet.addRow([
      dimensionLabels[p.rows],
      ...total.cols.map((c) => displayLabel(total.label(p.cols, c))),
      'Total',
      ...(total.showBudget ? ['Budget', 'Remaining', 'Used (%)'] : []),
    ]);
    sheet.lastRow!.font = { bold: true };
    const tableStart = sheet.rowCount + 1;
    /** Writes a bold sum row over the given source rows; returns the row number. */
    const sumRow = (label: string, view: ReportView, sources: string): number => {
      const row = sheet.addRow([label]);
      for (let i = 2; i <= width + 2; i++) {
        const result = i === width + 2 ? view.actualTotal : view.columnTotal(total.cols[i - 2]!);
        row.getCell(i).value = sources
          ? { formula: `SUM(${sources.replaceAll('#', letter(i))})`, result: result / 100 }
          : result / 100;
      }
      if (total.showBudget) {
        row.getCell(width + 3).value = view.budgetTotal / 100;
        row.getCell(width + 4).value = (view.budgetTotal - view.actualTotal) / 100;
        row.getCell(width + 5).value = formatPct1(view.actualTotal, view.budgetTotal);
      }
      row.font = { bold: true };
      return row.number;
    };
    const subtotalRows: number[] = [];
    let first = tableStart;
    for (const group of block.groups) {
      const view = group.view;
      if (block.grouped) {
        sheet.addRow([group.heading!]).font = { bold: true, italic: true };
        first = sheet.rowCount + 1;
      }
      for (const row of view.rows) {
        const actual = view.actualFor(row),
          budget = view.budgetFor(row);
        const idx = sheet.rowCount + 1;
        sheet.addRow([
          displayLabel(view.label(p.rows, row)),
          ...total.cols.map((c) => (view.data.cells.get(cellId(row, c)) ?? 0) / 100),
          width
            ? { formula: `SUM(B${idx}:${letter(width + 1)}${idx})`, result: actual / 100 }
            : actual / 100,
          ...(total.showBudget
            ? [budget / 100, (budget - actual) / 100, formatPct1(actual, budget)]
            : []),
        ]);
      }
      if (block.grouped) {
        const end = sheet.rowCount;
        subtotalRows.push(sumRow('Subtotal', view, end >= first ? `#${first}:#${end}` : ''));
      }
    }
    const end = sheet.rowCount;
    sumRow(
      'Total',
      total,
      block.grouped
        ? subtotalRows.map((r) => `#${r}`).join(',')
        : end >= tableStart
          ? `#${tableStart}:#${end}`
          : '',
    );
    for (let i = tableStart; i <= sheet.rowCount; i++)
      for (let j = 2; j <= numericColumns; j++)
        sheet.getRow(i).getCell(j).numFmt = '#,##0.00;[Red](#,##0.00)';
    sheet.addRow([]);
  }
  const detail = workbook.addWorksheet('Detail');
  detail.addRow([
    'Date',
    'Doc',
    'Source line',
    'Program',
    'Grant',
    'Budget line',
    'GL account',
    'Status',
    'Amount',
  ]);
  detail.getRow(1).font = { bold: true };
  for (const section of splitByMapping(facts))
    for (const f of section.facts)
      detail.addRow([
        f.date,
        f.doc,
        f.sourceLineId,
        displayLabel({ name: f.labels?.program ?? f.program, code: f.secondary?.program }),
        displayLabel({ name: f.labels?.grant ?? f.grant, code: f.secondary?.grant }),
        displayLabel({
          name: f.labels?.grantBudgetLine ?? f.grantBudgetLine,
          code: f.secondary?.grantBudgetLine,
        }),
        f.glAccount,
        f.status,
        f.amountCents / 100,
      ]);
  detail.getColumn(9).numFmt = '#,##0.00';
  const params = workbook.addWorksheet('Parameters');
  for (const [key, value] of Object.entries({
    rows: p.rows,
    cols: p.cols,
    page: p.page ?? '',
    from: p.from ?? '',
    to: p.to ?? '',
    grant: p.grant.join(','),
    program: p.program.join(','),
    account: p.account.join(','),
    restricted: String(p.restricted),
    unmapped: String(p.unmapped),
    zeros: String(p.zeros),
    budget: String(p.budget),
    mapping: String(p.mapping),
    run: runId,
    generatedAt: new Date().toISOString(),
  }))
    params.addRow([key, value]);
  return workbook.xlsx.writeBuffer();
}
