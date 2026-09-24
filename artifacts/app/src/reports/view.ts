import { cellId, pivot } from './pivot';
import type { Dimension, ReportParams } from './params';
import type { Fact, ReportBudgetLine } from './query';

export const budgetColumnsVisible = (p: ReportParams) =>
  p.budget && p.rows === 'grantBudgetLine' && (!p.page || p.page === 'grant');
export const budgetColumnsNote = (p: ReportParams) =>
  p.budget && p.rows === 'grantBudgetLine' && p.page && p.page !== 'grant';

export function reportSections(facts: Fact[]) {
  const mapped = facts.filter((f) => f.grant !== 'Unmapped');
  const unattributed = facts.filter((f) => f.grant === 'Unmapped');
  return [
    { heading: '', facts: mapped, kind: 'mapped' as const },
    {
      heading: 'Unmapped program expense — program-service expense without a grant budget line',
      facts: unattributed.filter((f) => f.functionalCategory === 'program'),
      kind: 'program' as const,
    },
    {
      heading: 'Non-grant expense — Management & General and Fundraising (expected)',
      facts: unattributed.filter((f) => f.functionalCategory !== 'program'),
      kind: 'non-grant' as const,
    },
  ];
}

export function reportPages(
  facts: Fact[],
  p: ReportParams,
  budgets: ReportBudgetLine[] = [],
  mapped = false,
) {
  if (!p.page) return [undefined];
  const keys = new Set(facts.map((f) => f[p.page!]));
  if (mapped && budgetColumnsVisible(p) && p.page === 'grant')
    for (const budget of budgets) keys.add(budget.grantKey);
  return [...keys].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
}

export function reportView(
  facts: Fact[],
  p: ReportParams,
  budgets: ReportBudgetLine[],
  pageKey?: string,
  mapped = false,
  columns?: string[],
) {
  const data = pivot(facts, { rows: p.rows, cols: p.cols, page: p.page, pageKey, zeros: p.zeros });
  const showBudget = mapped && budgetColumnsVisible(p);
  const scopedBudgets = showBudget
    ? budgets.filter((b) => p.page !== 'grant' || pageKey === b.grantKey)
    : [];
  const rows = showBudget
    ? [...new Set([...data.rowKeys, ...scopedBudgets.map((b) => b.code)])].sort(
        (a, b) =>
          (scopedBudgets.find((x) => x.code === a)?.sortOrder ?? 999999) -
            (scopedBudgets.find((x) => x.code === b)?.sortOrder ?? 999999) ||
          a.localeCompare(b, undefined, { numeric: true }),
      )
    : data.rowKeys;
  const cols = columns ?? data.colKeys;
  const budgetFor = (row: string) =>
    scopedBudgets.filter((b) => b.code === row).reduce((sum, b) => sum + b.budgetCents, 0);
  const actualFor = (row: string) =>
    cols.reduce((sum, col) => sum + (data.cells.get(cellId(row, col)) ?? 0), 0);
  const columnTotal = (col: string) =>
    rows.reduce((sum, row) => sum + (data.cells.get(cellId(row, col)) ?? 0), 0);
  const actualTotal = rows.reduce((sum, row) => sum + actualFor(row), 0);
  const budgetTotal = rows.reduce((sum, row) => sum + budgetFor(row), 0);
  const label = (dimension: Dimension, key: string) => {
    const fact = facts.find((f) => f[dimension] === key);
    const budget =
      dimension === 'grantBudgetLine' ? scopedBudgets.find((b) => b.code === key) : undefined;
    const grant = dimension === 'grant' ? budgets.find((b) => b.grantKey === key) : undefined;
    return {
      name: budget?.name ?? grant?.grantName ?? fact?.labels?.[dimension] ?? key,
      code: budget?.code ?? grant?.grantAward ?? fact?.secondary?.[dimension],
    };
  };
  return {
    data,
    rows,
    cols,
    label,
    showBudget,
    budgetFor,
    actualFor,
    columnTotal,
    actualTotal,
    budgetTotal,
  };
}

export const displayLabel = (label: { name: string; code?: string | null }) =>
  label.code && label.code !== label.name ? `${label.name} (${label.code})` : label.name;
