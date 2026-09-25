/**
 * Turn the private pilot workbook into committed, pseudonymized CSV fixtures.
 *
 *   pnpm fixtures:anonymize            # defaults below
 *   pnpm fixtures:anonymize -- --workbook "fixtures/private/Restricted Grants 9.21.xlsx" \
 *        --tab "Salah Costs=salah-export.csv" --tab "Opioid Costs=opioid-export.csv"
 *
 * Every string cell is rewritten with fixtures/private/pseudonyms.json (longest
 * term first, whole-word, case-insensitive); amounts and dates are copied as
 * printed so every "Total for" / TOTAL checksum still holds. Columns to the
 * right of the report header and rows after TOTAL are dropped. The run fails
 * if any denylist term survives or if the output no longer parses cleanly.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { cliArgs } from '@/cli/args';
import {
  type Cell,
  cellText,
  parseQboReport,
  type ParsedReport,
} from '@/datasource/qbo-report/parser';
import { readReportGrid } from '@/datasource/qbo-report/read';
import { toISODate } from '@/domain/dates';
import {
  DENYLIST_PATH,
  PSEUDONYMS_PATH,
  findDenylistedTerms,
  loadDenylist,
  termPattern,
} from '@/privacy/scan';

interface Replacement {
  pattern: RegExp;
  replacement: string;
}

export function buildReplacements(pseudonyms: Record<string, string>): Replacement[] {
  return Object.entries(pseudonyms)
    .sort((a, b) => b[0].length - a[0].length)
    .map(([term, replacement]) => ({
      pattern: new RegExp(termPattern(term).source, 'giu'),
      replacement,
    }));
}

export function pseudonymize(text: string, replacements: Replacement[]): string {
  let out = text;
  for (const { pattern, replacement } of replacements) out = out.replace(pattern, replacement);
  return out;
}

function csvField(value: string): string {
  return /[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

function formatCell(cell: Cell, isAmount: boolean, replacements: Replacement[]): string {
  if (cell == null || cell === '') return '';
  if (cell instanceof Date) {
    const iso = toISODate(new Date(Math.round(cell.getTime() / 86_400_000) * 86_400_000));
    const [y, m, d] = iso.split('-');
    return `${m}/${d}/${y}`;
  }
  if (typeof cell === 'number') {
    return isAmount ? (Math.round(cell * 100) / 100).toFixed(2) : String(cell);
  }
  if (typeof cell === 'object') {
    const o = cell as { result?: Cell };
    if (o.result !== undefined) return formatCell(o.result, isAmount, replacements);
  }
  return pseudonymize(cellText(cell), replacements);
}

/** Rows 1..TOTAL, columns up to the rightmost header column, title rows collapsed to one cell. */
export function anonymizeGrid(
  rows: Cell[][],
  report: ParsedReport,
  replacements: Replacement[],
): string[][] {
  if (report.headerRow === null) throw new Error('report has no header row');
  const columns = report.columns as Record<string, number>;
  const width = Math.max(...Object.values(columns)) + 1;
  const amountIndex = columns.amount!;
  const totalRow = report.checksums.find((c) => c.label === 'TOTAL')?.row ?? rows.length;
  const out: string[][] = [];
  for (let i = 0; i < totalRow; i++) {
    const row = rows[i] ?? [];
    if (i < report.headerRow - 1) {
      const first = row.map((c) => cellText(c)).find((t) => t !== '') ?? '';
      const line = new Array<string>(width).fill('');
      line[0] = pseudonymize(first, replacements);
      out.push(line);
      continue;
    }
    const line: string[] = [];
    for (let c = 0; c < width; c++) {
      line.push(formatCell(row[c], c === amountIndex, replacements));
    }
    out.push(line);
  }
  return out;
}

async function main() {
  const { values } = parseArgs({
    args: cliArgs(),
    options: {
      workbook: { type: 'string', default: 'fixtures/private/Restricted Grants 9.21.xlsx' },
      pseudonyms: { type: 'string', default: PSEUDONYMS_PATH },
      denylist: { type: 'string', default: DENYLIST_PATH },
      out: { type: 'string', default: 'fixtures/pilot' },
      tab: { type: 'string', multiple: true },
    },
  });
  const tabs = (
    values.tab?.length
      ? values.tab
      : ['Salah Costs=salah-export.csv', 'Opioid Costs=opioid-export.csv']
  ).map((spec) => {
    const [sheet, file] = spec.split('=');
    if (!sheet || !file) throw new Error(`--tab expects "Sheet name=file.csv", got "${spec}"`);
    return { sheet, file };
  });
  const pseudonyms = JSON.parse(readFileSync(values.pseudonyms!, 'utf8')) as Record<string, string>;
  const denylist = loadDenylist(values.denylist!);
  const replacements = buildReplacements(pseudonyms);
  const workbook = readFileSync(values.workbook!);
  mkdirSync(values.out!, { recursive: true });

  let failed = false;
  for (const { sheet, file } of tabs) {
    const grid = await readReportGrid(workbook, path.basename(values.workbook!), { sheet });
    const source = parseQboReport(grid.rows, { fileName: sheet });
    if (source.errors.length > 0 || source.headerRow === null) {
      failed = true;
      console.error(`${sheet}: source sheet does not parse cleanly`);
      for (const e of source.errors) console.error(`  row ${e.row ?? '-'} ${e.code}: ${e.message}`);
      continue;
    }
    const csvRows = anonymizeGrid(grid.rows, source, replacements);
    const csv = csvRows.map((r) => r.map(csvField).join(',')).join('\n') + '\n';

    const hits = findDenylistedTerms(csv, denylist);
    if (hits.length > 0) {
      failed = true;
      console.error(`${sheet}: ${hits.length} denylisted term(s) survived — add pseudonyms for:`);
      for (const h of hits) console.error(`  ${h.term} (${h.count})`);
      continue;
    }
    const check = parseQboReport(csvRows, { fileName: file });
    const badChecksum = check.checksums.filter((c) => !c.passed);
    if (
      check.errors.length > 0 ||
      badChecksum.length > 0 ||
      check.lines.length !== source.lines.length
    ) {
      failed = true;
      console.error(
        `${sheet}: anonymized output does not round-trip (${check.errors.length} errors, ${badChecksum.length} bad checksums, ${check.lines.length}/${source.lines.length} lines)`,
      );
      for (const e of check.errors) console.error(`  row ${e.row ?? '-'} ${e.code}: ${e.message}`);
      continue;
    }
    const target = path.join(values.out!, file);
    writeFileSync(target, csv);
    const total = check.checksums.find((c) => c.label === 'TOTAL');
    console.log(
      `${sheet} → ${target}: ${check.lines.length} lines, ${check.accounts.length} accounts, ${check.checksums.length} checksums ok, TOTAL ${total ? (total.expectedCents / 100).toFixed(2) : '?'}`,
    );
  }
  if (failed) process.exit(1);
}

const isMain = process.argv[1] && /anonymize-qbo-report\.(ts|js)$/.test(process.argv[1]);
if (isMain) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
