import ExcelJS from 'exceljs';
import { centsToDecimalString, formatPct1 } from '@/domain/money';
import { cellId, pivot } from './pivot';
import { dimensionLabels, type ReportParams } from './params';
import type { Fact, ReportBudgetLine } from './query';
import { budgetColumnsNote, displayLabel, reportPages, reportSections, reportView } from './view';

export const pageKeys = (facts: Fact[], p: ReportParams) => reportPages(facts, p);

export function exportViews(facts: Fact[], p: ReportParams, budgets: ReportBudgetLine[]) {
  return reportSections(facts).flatMap((section) => {
    if (
      !section.facts.length &&
      !(section.kind === 'mapped' && budgets.length && p.budget && p.rows === 'grantBudgetLine')
    )
      return [];
    const columns = pivot(section.facts, { rows: p.rows, cols: p.cols, zeros: p.zeros }).colKeys;
    return reportPages(section.facts, p, budgets, section.kind === 'mapped').map((key) => ({
      section: section.heading || 'Grant expenses',
      pageKey: key,
      view: reportView(section.facts, p, budgets, key, section.kind === 'mapped', columns),
    }));
  });
}

export function csvReport(facts: Fact[], p: ReportParams, budgets: ReportBudgetLine[] = []) {
  const quote = (v: string | number) => `"${String(v).replaceAll('"', '""')}"`;
  const lines: (string | number)[][] = [];
  if (budgetColumnsNote(p))
    lines.push(['Budget columns are shown when the report is broken by grant or not at all']);
  for (const { section, pageKey, view } of exportViews(facts, p, budgets)) {
    lines.push([section, pageKey === undefined ? '' : displayLabel(view.label(p.page!, pageKey))]);
    lines.push([
      dimensionLabels[p.rows],
      ...view.cols.map((c) => `${displayLabel(view.label(p.cols, c))} ($)`),
      'Total ($)',
      ...(view.showBudget ? ['Budget ($)', 'Remaining ($)', 'Used (%)'] : []),
    ]);
    for (const row of view.rows) {
      const actual = view.actualFor(row),
        budget = view.budgetFor(row);
      lines.push([
        displayLabel(view.label(p.rows, row)),
        ...view.cols.map((c) => centsToDecimalString(view.data.cells.get(cellId(row, c)) ?? 0)),
        centsToDecimalString(actual),
        ...(view.showBudget
          ? [
              centsToDecimalString(budget),
              centsToDecimalString(budget - actual),
              formatPct1(actual, budget),
            ]
          : []),
      ]);
    }
    lines.push([
      'Total',
      ...view.cols.map((c) => centsToDecimalString(view.columnTotal(c))),
      centsToDecimalString(view.actualTotal),
      ...(view.showBudget
        ? [
            centsToDecimalString(view.budgetTotal),
            centsToDecimalString(view.budgetTotal - view.actualTotal),
            formatPct1(view.actualTotal, view.budgetTotal),
          ]
        : []),
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
  for (const { section, pageKey, view } of exportViews(facts, p, budgets)) {
    sheet.addRow([
      section,
      pageKey === undefined ? '' : displayLabel(view.label(p.page!, pageKey)),
    ]);
    sheet.lastRow!.font = { bold: true };
    sheet.addRow([
      dimensionLabels[p.rows],
      ...view.cols.map((c) => displayLabel(view.label(p.cols, c))),
      'Total',
      ...(view.showBudget ? ['Budget', 'Remaining', 'Used (%)'] : []),
    ]);
    sheet.lastRow!.font = { bold: true };
    const first = sheet.rowCount + 1;
    for (const row of view.rows) {
      const actual = view.actualFor(row),
        budget = view.budgetFor(row);
      const idx = sheet.rowCount + 1;
      const lastCol = sheet.getColumn(view.cols.length + 1).letter;
      sheet.addRow([
        displayLabel(view.label(p.rows, row)),
        ...view.cols.map((c) => (view.data.cells.get(cellId(row, c)) ?? 0) / 100),
        view.cols.length
          ? { formula: `SUM(B${idx}:${lastCol}${idx})`, result: actual / 100 }
          : actual / 100,
        ...(view.showBudget
          ? [budget / 100, (budget - actual) / 100, formatPct1(actual, budget)]
          : []),
      ]);
    }
    const end = sheet.rowCount;
    const total = sheet.addRow(['Total']);
    for (let i = 2; i <= view.cols.length + 2; i++) {
      const result =
        i === view.cols.length + 2 ? view.actualTotal : view.columnTotal(view.cols[i - 2]!);
      total.getCell(i).value =
        end >= first
          ? {
              formula: `SUM(${sheet.getColumn(i).letter}${first}:${sheet.getColumn(i).letter}${end})`,
              result: result / 100,
            }
          : result / 100;
    }
    if (view.showBudget) {
      total.getCell(view.cols.length + 3).value = view.budgetTotal / 100;
      total.getCell(view.cols.length + 4).value = (view.budgetTotal - view.actualTotal) / 100;
      total.getCell(view.cols.length + 5).value = formatPct1(view.actualTotal, view.budgetTotal);
    }
    total.font = { bold: true };
    for (let i = first; i <= sheet.rowCount; i++)
      for (let j = 2; j <= view.cols.length + (view.showBudget ? 4 : 2); j++)
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
  for (const section of reportSections(facts))
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
    run: runId,
    generatedAt: new Date().toISOString(),
  }))
    params.addRow([key, value]);
  return workbook.xlsx.writeBuffer();
}
