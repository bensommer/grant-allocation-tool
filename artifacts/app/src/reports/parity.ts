/**
 * Parity report (JPH-23 AC8): the bookkeeper's workbook cells beside the app's
 * figures. Everything private stays under `fixtures/private/`: the workbook, the
 * cell map and the report. This module never touches the database — the caller
 * supplies a metric resolver — so it can be tested without the private files.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import ExcelJS from 'exceljs';
import { execFileSync } from 'node:child_process';
import { z } from 'zod';
import { formatMoney } from '@/domain/format';
import { listTrackedFiles } from '@/privacy/scan';

export const parityMapSchema = z.array(
  z.object({
    sheet: z.string().min(1),
    cell: z.string().regex(/^[A-Z]{1,3}\d+$/, 'cell like G42'),
    label: z.string().min(1),
    /** Metric key the resolver understands, e.g. "salah:budget:FAC:charged". */
    appMetric: z.string().min(1),
    /** Why the two figures agree or differ; every row must say. */
    reason: z.string().min(1, 'every mapped row needs a reason'),
    /** Multiply the workbook value by this before comparing (her released rows are negative). */
    sign: z.union([z.literal(1), z.literal(-1)]).default(1),
  }),
);
export type ParityMap = z.infer<typeof parityMapSchema>;
export type ParityRow = ParityMap[number];

export type MetricResolver = (metric: string) => Promise<number | null>;

export interface ParityLine {
  label: string;
  sheet: string;
  cell: string;
  /** Workbook value in cents (half-up), null when the cell is empty or an error. */
  workbookCents: number | null;
  appCents: number | null;
  differenceCents: number | null;
  reason: string;
}

/** Cached numeric value of a cell (formula results included), or null. */
export function cellNumber(ws: ExcelJS.Worksheet, address: string): number | null {
  const v = ws.getCell(address).value;
  if (v === null || v === undefined) return null;
  if (typeof v === 'number') return v;
  if (typeof v === 'object') {
    if ('error' in v) return null;
    if ('formula' in v || 'sharedFormula' in v) {
      // A formula whose cached result is blank: Excel stored an empty <v>, i.e. 0.
      if (v.result === undefined || v.result === null) return 0;
      return typeof v.result === 'number' ? v.result : null;
    }
  }
  if (typeof v === 'string' && v.trim() !== '' && !Number.isNaN(Number(v))) return Number(v);
  return null;
}

/** Dollars → integer cents, half away from zero (Excel's ROUND). */
export const toCents = (dollars: number) => Math.sign(dollars) * Math.round(Math.abs(dollars) * 100 + 1e-9);

export async function compareParity(
  workbookPath: string,
  map: ParityMap,
  resolve: MetricResolver,
): Promise<ParityLine[]> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(workbookPath);
  const out: ParityLine[] = [];
  for (const row of map) {
    const ws = wb.getWorksheet(row.sheet);
    if (!ws) throw new Error(`parity map: sheet "${row.sheet}" is not in the workbook`);
    const raw = cellNumber(ws, row.cell);
    const workbookCents = raw === null ? null : toCents(raw) * row.sign;
    const appCents = await resolve(row.appMetric);
    out.push({
      label: row.label,
      sheet: row.sheet,
      cell: row.cell,
      workbookCents,
      appCents,
      differenceCents:
        workbookCents === null || appCents === null ? null : appCents - workbookCents,
      reason: row.reason,
    });
  }
  return out;
}

const money = (c: number | null) => (c === null ? '—' : formatMoney(c, { zero: 'zero' }));

export function renderParityMarkdown(
  lines: ParityLine[],
  meta: { workbook: string; generatedAt: Date; range: { from: string; to: string }; runId: string | null },
): string {
  const head = [
    '# Parity report',
    '',
    `Workbook: \`${path.basename(meta.workbook)}\` (cached cell values) · App run: ${meta.runId ?? 'none'} · Rollforward window ${meta.range.from} → ${meta.range.to} · Generated ${meta.generatedAt.toISOString()}`,
    '',
    'Difference = app − workbook, in dollars. Private: this file lives under `fixtures/private/` and is never committed.',
    '',
    '| Label | Sheet!Cell | Workbook | App | Difference | Reason |',
    '|---|---|---:|---:|---:|---|',
  ];
  const body = lines.map(
    (l) =>
      `| ${l.label} | ${l.sheet}!${l.cell} | ${money(l.workbookCents)} | ${money(l.appCents)} | ${money(l.differenceCents)} | ${l.reason} |`,
  );
  const ties = lines.filter((l) => l.differenceCents === 0).length;
  const unresolved = lines.filter((l) => l.appCents === null || l.workbookCents === null).length;
  return [
    ...head,
    ...body,
    '',
    `${lines.length} rows · ${ties} tie exactly · ${lines.length - ties - unresolved} differ with a stated reason · ${unresolved} unresolved.`,
    '',
  ].join('\n');
}

/**
 * True when git already tracks `file`, or would offer to add it — i.e. anything
 * inside the work tree that is not covered by an ignore rule, whether or not it
 * exists yet. Writing there would leak the workbook figures.
 */
export function isTrackedPath(repoDir: string, file: string): boolean {
  const abs = path.resolve(file);
  const rel = path.relative(repoDir, abs).split(path.sep).join('/');
  if (rel.startsWith('..')) return false;
  let files: string[];
  try {
    files = listTrackedFiles(repoDir);
  } catch (e) {
    // Outside any work tree nothing can be tracked; any other git failure is real.
    if (/not a git repository/i.test(String((e as { stderr?: Buffer }).stderr ?? e))) return false;
    throw e;
  }
  if (files.includes(rel)) return true;
  return !isIgnoredPath(repoDir, rel);
}

/** `git check-ignore`: exit 0 = ignored, 1 = not ignored, anything else = a real error. */
function isIgnoredPath(repoDir: string, rel: string): boolean {
  try {
    execFileSync('git', ['check-ignore', '-q', '--', rel], { cwd: repoDir, stdio: 'pipe' });
    return true;
  } catch (e) {
    const status = (e as { status?: number }).status;
    if (status === 1) return false;
    throw e;
  }
}

export type ParityRunResult =
  | { status: 'skipped'; reason: string }
  | { status: 'written'; outPath: string; lines: ParityLine[] };

/**
 * Generate the report. Skips (without writing) when the workbook or map is
 * absent; refuses when the output path is tracked by git.
 */
export async function runParityReport(opts: {
  repoDir: string;
  workbookPath: string;
  mapPath: string;
  outPath: string;
  resolve: MetricResolver;
  meta: { range: { from: string; to: string }; runId: string | null };
}): Promise<ParityRunResult> {
  if (!existsSync(opts.workbookPath))
    return { status: 'skipped', reason: `workbook not present: ${opts.workbookPath}` };
  if (!existsSync(opts.mapPath))
    return { status: 'skipped', reason: `parity map not present: ${opts.mapPath}` };
  if (isTrackedPath(opts.repoDir, opts.outPath))
    throw new Error(`refusing to write parity report to a git-tracked path: ${opts.outPath}`);
  const map = parityMapSchema.parse(JSON.parse(readFileSync(opts.mapPath, 'utf8')));
  const lines = await compareParity(opts.workbookPath, map, opts.resolve);
  const md = renderParityMarkdown(lines, {
    workbook: opts.workbookPath,
    generatedAt: new Date(),
    ...opts.meta,
  });
  // Re-check right before writing: the tree may have changed while we read.
  if (isTrackedPath(opts.repoDir, opts.outPath))
    throw new Error(`refusing to write parity report to a git-tracked path: ${opts.outPath}`);
  writeFileSync(opts.outPath, md);
  return { status: 'written', outPath: opts.outPath, lines };
}
