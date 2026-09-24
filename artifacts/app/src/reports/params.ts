import { z } from 'zod';

export const dimensions = [
  'grant',
  'grantBudgetLine',
  'program',
  'functionalCategory',
  'glAccount',
  'glAccountType',
  'class',
  'month',
  'quarter',
] as const;
export type Dimension = (typeof dimensions)[number];
export const dimensionLabels: Record<Dimension, string> = {
  grant: 'Grant',
  grantBudgetLine: 'Grant budget line',
  program: 'Program',
  functionalCategory: 'Functional category',
  glAccount: 'GL account',
  glAccountType: 'GL account type',
  class: 'Class',
  month: 'Month',
  quarter: 'Quarter',
};
const date = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .optional();
export const reportSchema = z.object({
  rows: z.enum(dimensions).default('program'),
  cols: z.enum(dimensions).default('glAccount'),
  page: z.enum(dimensions).optional(),
  from: date,
  to: date,
  grant: z.array(z.string()).default([]),
  program: z.array(z.string()).default([]),
  account: z.array(z.string()).default([]),
  restricted: z.boolean().default(false),
  unmapped: z.boolean().default(true),
  zeros: z.boolean().default(false),
  run: z.string().optional(),
  rowKey: z.string().optional(),
  colKey: z.string().optional(),
  pageKey: z.string().optional(),
});
export type ReportParams = z.infer<typeof reportSchema>;

export function parseParams(
  query: URLSearchParams | Record<string, string | string[] | undefined>,
): ReportParams {
  const q =
    query instanceof URLSearchParams
      ? query
      : new URLSearchParams(
          Object.entries(query).flatMap(([k, v]) =>
            Array.isArray(v) ? v.map((x) => [k, x]) : v == null ? [] : [[k, v]],
          ),
        );
  const flag = (name: string, fallback: boolean) =>
    q.has(name) ? q.getAll(name).some((v) => ['1', 'true', 'on'].includes(v)) : fallback;
  const parsed = reportSchema.parse({
    rows: q.get('rows') || undefined,
    cols: q.get('cols') || undefined,
    page: q.get('page') || undefined,
    from: q.get('from') || undefined,
    to: q.get('to') || undefined,
    grant: q.getAll('grant').filter(Boolean),
    program: q.getAll('program').filter(Boolean),
    account: q.getAll('account').filter(Boolean),
    restricted: flag('restricted', false),
    unmapped: flag('unmapped', true),
    zeros: flag('zeros', false),
    run: q.get('run') || undefined,
    rowKey: q.get('rowKey') || undefined,
    colKey: q.get('colKey') || undefined,
    pageKey: q.get('pageKey') || undefined,
  });
  if (parsed.rows === parsed.cols || parsed.page === parsed.rows || parsed.page === parsed.cols)
    throw new Error('Report dimensions must be distinct');
  if (parsed.from && parsed.to && parsed.from > parsed.to)
    throw new Error('From date must precede to date');
  for (const d of [parsed.from, parsed.to])
    if (d && Number.isNaN(new Date(d).getTime())) throw new Error('Invalid date');
  return parsed;
}
