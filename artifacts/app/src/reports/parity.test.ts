import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import ExcelJS from 'exceljs';
import { beforeAll, describe, expect, it } from 'vitest';
import { isTrackedPath, runParityReport, toCents } from './parity';

let dir: string;
let workbook: string;

const META = { range: { from: '2026-01-01', to: '2026-09-22' }, runId: 'run-1' };
const APP: Record<string, number> = {
  'opioid:rollforward:beginning': 1_404_700,
  'opioid:rollforward:direct': 510_654,
  'opioid:grid:total:PRACT:remaining': 0,
};
const resolve = async (m: string) => APP[m] ?? null;

function writeMap(file: string, rows: unknown[]) {
  writeFileSync(file, JSON.stringify(rows));
}

beforeAll(async () => {
  dir = mkdtempSync(path.join(os.tmpdir(), 'parity-'));
  // A stand-in for the private workbook: plain values, cached formula results,
  // a formula whose cache is blank, and an error cell.
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Restricted Grants');
  ws.getCell('E8').value = 14047;
  ws.getCell('E11').value = { formula: "-'Opioid Costs'!D174", result: -5106.54 };
  ws.getCell('D41').value = { formula: 'D3-D32' } as ExcelJS.CellFormulaValue;
  ws.getCell('C49').value = { error: '#DIV/0!' } as ExcelJS.CellErrorValue;
  workbook = path.join(dir, 'book.xlsx');
  await wb.xlsx.writeFile(workbook);
});

describe('parity report (AC8)', () => {
  it('rounds workbook dollars to cents half away from zero', () => {
    expect(toCents(5226.560649)).toBe(522_656);
    expect(toCents(-21520.399999999994)).toBe(-2_152_040);
    expect(toCents(0.005)).toBe(1);
    expect(toCents(-0.005)).toBe(-1);
  });

  it('skips cleanly, writing nothing, when the private workbook is absent', async () => {
    const mapPath = path.join(dir, 'map-a.json');
    writeMap(mapPath, []);
    const out = path.join(dir, 'absent.md');
    const r = await runParityReport({
      repoDir: dir,
      workbookPath: path.join(dir, 'missing.xlsx'),
      mapPath,
      outPath: out,
      resolve,
      meta: META,
    });
    expect(r.status).toBe('skipped');
    expect(existsSync(out)).toBe(false);
  });

  it('writes label / workbook / app / difference / reason for every mapped cell', async () => {
    const mapPath = path.join(dir, 'map-b.json');
    writeMap(mapPath, [
      { sheet: 'Restricted Grants', cell: 'E8', label: 'Opioid beginning', appMetric: 'opioid:rollforward:beginning', reason: 'matches' },
      { sheet: 'Restricted Grants', cell: 'E11', label: 'Opioid direct', appMetric: 'opioid:rollforward:direct', reason: 'matches', sign: -1 },
      { sheet: 'Restricted Grants', cell: 'D41', label: 'Blank cache', appMetric: 'opioid:grid:total:PRACT:remaining', reason: 'blank read as 0' },
      { sheet: 'Restricted Grants', cell: 'C49', label: 'Error cell', appMetric: 'opioid:rollforward:direct', reason: 'her #DIV/0!' },
      { sheet: 'Restricted Grants', cell: 'E8', label: 'Unknown app metric', appMetric: 'nothing:here', reason: 'not in app' },
    ]);
    const out = path.join(dir, 'parity.md');
    const r = await runParityReport({ repoDir: dir, workbookPath: workbook, mapPath, outPath: out, resolve, meta: META });
    expect(r.status).toBe('written');
    if (r.status !== 'written') return;
    expect(r.lines.map((l) => [l.workbookCents, l.appCents, l.differenceCents])).toEqual([
      [1_404_700, 1_404_700, 0],
      [510_654, 510_654, 0],
      [0, 0, 0],
      [null, 510_654, null],
      [1_404_700, null, null],
    ]);
    const md = readFileSync(out, 'utf8');
    expect(md).toContain('| Label | Sheet!Cell | Workbook | App | Difference | Reason |');
    expect(md).toContain('| Opioid direct | Restricted Grants!E11 | 5,106.54 | 5,106.54 | 0.00 | matches |');
    expect(md).toContain('| Error cell | Restricted Grants!C49 | — | 5,106.54 | — | her #DIV/0! |');
    expect(md).toContain('3 tie exactly');
    expect(md).toContain('2 unresolved');
    for (const l of r.lines) expect(l.reason.length).toBeGreaterThan(0);
  });

  it('rejects a mapped row without a reason before reading anything', async () => {
    const mapPath = path.join(dir, 'map-c.json');
    writeMap(mapPath, [{ sheet: 'Restricted Grants', cell: 'E8', label: 'x', appMetric: 'opioid:rollforward:beginning' }]);
    const out = path.join(dir, 'no-reason.md');
    await expect(
      runParityReport({ repoDir: dir, workbookPath: workbook, mapPath, outPath: out, resolve, meta: META }),
    ).rejects.toThrow(/reason/);
    expect(existsSync(out)).toBe(false);
  });

  it('refuses to write to a path git tracks', async () => {
    const repo = mkdtempSync(path.join(os.tmpdir(), 'parity-repo-'));
    const git = (...args: string[]) =>
      execFileSync('git', args, {
        cwd: repo,
        stdio: 'pipe',
        env: {
          ...process.env,
          GIT_AUTHOR_NAME: 't',
          GIT_AUTHOR_EMAIL: 't@example.com',
          GIT_COMMITTER_NAME: 't',
          GIT_COMMITTER_EMAIL: 't@example.com',
        },
      });
    git('init', '-q');
    const tracked = path.join(repo, 'parity.md');
    writeFileSync(tracked, 'committed\n');
    git('add', 'parity.md');
    git('commit', '-q', '-m', 'track');
    expect(isTrackedPath(repo, tracked)).toBe(true);
    // Untracked but not ignored counts too: git would offer to add it.
    const loose = path.join(repo, 'loose.md');
    writeFileSync(loose, '');
    expect(isTrackedPath(repo, loose)).toBe(true);
    writeFileSync(path.join(repo, '.gitignore'), 'private/\n');
    git('add', '.gitignore');
    git('commit', '-q', '-m', 'ignore');
    execFileSync('mkdir', ['-p', path.join(repo, 'private')]);
    expect(isTrackedPath(repo, path.join(repo, 'private', 'parity.md'))).toBe(false);
    // A file that does not exist yet but would not be ignored counts too.
    expect(isTrackedPath(repo, path.join(repo, 'fresh-public.md'))).toBe(true);
    expect(isTrackedPath(repo, path.join(repo, 'private', 'fresh.md'))).toBe(false);

    const mapPath = path.join(dir, 'map-d.json');
    writeMap(mapPath, [
      { sheet: 'Restricted Grants', cell: 'E8', label: 'x', appMetric: 'opioid:rollforward:beginning', reason: 'matches' },
    ]);
    await expect(
      runParityReport({ repoDir: repo, workbookPath: workbook, mapPath, outPath: tracked, resolve, meta: META }),
    ).rejects.toThrow(/git-tracked/);
    expect(readFileSync(tracked, 'utf8')).toBe('committed\n');
  });
});
