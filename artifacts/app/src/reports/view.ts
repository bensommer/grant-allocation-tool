import { axisOrder, cellId, pivot } from './pivot';
import type { Dimension, ReportParams } from './params';
import type { Fact, ReportBudgetLine } from './query';

export const budgetColumnsVisible = (p: ReportParams) =>
  p.budget && p.rows === 'grantBudgetLine' && (!p.page || p.page === 'grant');
export const budgetColumnsNote = (p: ReportParams) =>
  p.budget && p.rows === 'grantBudgetLine' && p.page && p.page !== 'grant';

export type ReportLayout = 'single' | 'sections';
/**
 * A report with a program axis is a functional-expense view: one table, all programs, one column
 * set, one grand total. Grant-oriented views (no program axis, or paged by grant) keep the
 * mapped / unmapped / non-grant split because "Unmapped" is not a grant.
 */
export const reportLayout = (p: ReportParams): ReportLayout =>
  (p.rows === 'program' || p.cols === 'program') && p.page !== 'grant' ? 'single' : 'sections';

export type MappingKind = 'mapped' | 'program' | 'non-grant';
export const mappingKinds: ReadonlyArray<{
  kind: MappingKind;
  heading: string;
  match: (f: Fact) => boolean;
}> = [
  {
    kind: 'mapped',
    heading: 'Charged to grant budget lines',
    match: (f) => f.grant !== 'Unmapped',
  },
  {
    kind: 'program',
    heading: 'Program expense not charged to any grant',
    match: (f) => f.grant === 'Unmapped' && f.functionalCategory === 'program',
  },
  {
    kind: 'non-grant',
    heading: 'Non-grant expense — Management & General and Fundraising (expected)',
    match: (f) => f.grant === 'Unmapped' && f.functionalCategory !== 'program',
  },
];
export const splitByMapping = (facts: Fact[]) =>
  mappingKinds.map((m) => ({ ...m, facts: facts.filter(m.match) }));

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

const placeholderLabels: Partial<Record<Dimension, string>> = {
  grant: 'Not charged to any grant',
  grantBudgetLine: 'No grant budget line',
};

export function reportView(
  facts: Fact[],
  p: ReportParams,
  budgets: ReportBudgetLine[],
  pageKey?: string,
  mapped = false,
  columns?: string[],
  /** Where axis labels are resolved; the whole report, so shared columns label consistently. */
  labelFacts: Fact[] = facts,
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
  const scoped =
    pageKey === undefined ? facts : facts.filter((f) => p.page && f[p.page] === pageKey);
  const budgetFor = (row: string) =>
    scopedBudgets.filter((b) => b.code === row).reduce((sum, b) => sum + b.budgetCents, 0);
  const actualFor = (row: string) =>
    cols.reduce((sum, col) => sum + (data.cells.get(cellId(row, col)) ?? 0), 0);
  const columnTotal = (col: string) =>
    rows.reduce((sum, row) => sum + (data.cells.get(cellId(row, col)) ?? 0), 0);
  /** Program-service expense in this row that no grant budget line claimed. */
  const unmappedFor = (row: string) =>
    scoped.reduce(
      (sum, f) =>
        f[p.rows] === row && f.grant === 'Unmapped' && f.functionalCategory === 'program'
          ? sum + f.amountCents
          : sum,
      0,
    );
  const categoryOf = (row: string) => data.rowLabels.get(row)?.functionalCategory;
  const actualTotal = rows.reduce((sum, row) => sum + actualFor(row), 0);
  const budgetTotal = rows.reduce((sum, row) => sum + budgetFor(row), 0);
  const label = (dimension: Dimension, key: string) => {
    if (key === 'Unmapped' && placeholderLabels[dimension])
      return { name: placeholderLabels[dimension]!, code: undefined };
    const fact = labelFacts.find((f) => f[dimension] === key);
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
    unmappedFor,
    categoryOf,
    columnTotal,
    actualTotal,
    budgetTotal,
  };
}
export type ReportView = ReturnType<typeof reportView>;

export type ReportGroup = { kind: MappingKind | 'all'; heading?: string; view: ReportView };
export type ReportBlock = {
  pageKey?: string;
  /** Row groups rendered inside one table; a single "all" group unless grouped by mapping. */
  groups: ReportGroup[];
  /** The whole table: shared columns, column totals and the grand total. */
  total: ReportView;
  grouped: boolean;
};
export type ReportSection = {
  kind: 'single' | MappingKind;
  heading: string;
  mapped: boolean;
  blocks: ReportBlock[];
};

/**
 * Everything the screen and the exports render, in order. Every table in a report shares one
 * column set so the sections line up; each table carries its own grand total.
 */
export function reportSections(
  facts: Fact[],
  p: ReportParams,
  budgets: ReportBudgetLine[],
): ReportSection[] {
  // One column set for every table of the report, taken from what each displayed table actually
  // shows: pivoting all facts at once would let opposite amounts in different groups or pages net
  // to zero and drop a column that is nonzero in each of them.
  const colSort = axisOrder(
    p.cols,
    pivot(facts, { rows: p.rows, cols: p.cols, zeros: true }).colLabels,
  );
  const unionColumns = (parts: Array<{ facts: Fact[]; pageKey?: string }>) =>
    [
      ...new Set(
        parts.flatMap(
          (part) =>
            pivot(part.facts, {
              rows: p.rows,
              cols: p.cols,
              page: p.page,
              pageKey: part.pageKey,
              zeros: p.zeros,
            }).colKeys,
        ),
      ),
    ].sort(colSort);
  const budgetOnlyRows = budgets.length > 0 && p.budget && p.rows === 'grantBudgetLine';
  if (reportLayout(p) === 'single') {
    if (!facts.length && !budgetOnlyRows) return [];
    const pageKeys = reportPages(facts, p, budgets, true);
    const groupsOf = p.mapping ? splitByMapping(facts) : [{ kind: 'all' as const, facts }];
    const columns = unionColumns(
      pageKeys.flatMap((pageKey) => groupsOf.map((g) => ({ facts: g.facts, pageKey }))),
    );
    const blocks = pageKeys.map((pageKey): ReportBlock => {
      const total = reportView(facts, p, budgets, pageKey, true, columns);
      const groups: ReportGroup[] = p.mapping
        ? splitByMapping(facts)
            .map((g) => ({
              kind: g.kind,
              heading: g.heading,
              view: reportView(g.facts, p, budgets, pageKey, g.kind === 'mapped', columns, facts),
            }))
            .filter((g) => g.view.rows.length)
        : [{ kind: 'all', view: total }];
      return { pageKey, groups, total, grouped: p.mapping };
    });
    return [{ kind: 'single', heading: '', mapped: true, blocks }];
  }
  const sections = splitByMapping(facts).flatMap((section) => {
    const mapped = section.kind === 'mapped';
    if (!section.facts.length && !(mapped && budgetOnlyRows)) return [];
    // Unmapped pieces all share the "Unmapped" grant key; never present them as a grant page.
    const pages =
      !mapped && p.page === 'grant' ? [undefined] : reportPages(section.facts, p, budgets, mapped);
    return [{ ...section, mapped, pages }];
  });
  const columns = unionColumns(
    sections.flatMap((section) =>
      section.pages.map((pageKey) => ({ facts: section.facts, pageKey })),
    ),
  );
  return sections.map((section): ReportSection => {
    const { mapped } = section;
    const blocks = section.pages.map((pageKey): ReportBlock => {
      const view = reportView(section.facts, p, budgets, pageKey, mapped, columns, facts);
      return { pageKey, groups: [{ kind: 'all', view }], total: view, grouped: false };
    });
    return { kind: section.kind, heading: mapped ? '' : section.heading, mapped, blocks };
  });
}

export const displayLabel = (label: { name: string; code?: string | null }) =>
  label.code && label.code !== label.name ? `${label.name} (${label.code})` : label.name;
