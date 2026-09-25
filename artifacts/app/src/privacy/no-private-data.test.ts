import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { DENYLIST_PATH, loadDenylist, scanRepo, termPattern } from './scan';

/**
 * JPH-20 privacy guardrail: nothing git knows about may contain a real name
 * from the pilot workbook. The denylist is private and git-ignored, so this
 * suite skips (loudly) when it is absent.
 */
const appDir = path.resolve(__dirname, '../..');
const repoRoot = execFileSync('git', ['rev-parse', '--show-toplevel'], { cwd: appDir })
  .toString('utf8')
  .trim();
const denylistFile = path.join(appDir, DENYLIST_PATH);
const hasDenylist = existsSync(denylistFile);

describe('no private data in tracked files', () => {
  it.skipIf(!hasDenylist)('no git-tracked file contains a denylisted term', () => {
    const denylist = loadDenylist(denylistFile);
    expect(denylist.length).toBeGreaterThan(0);
    const hits = scanRepo(repoRoot, denylist);
    // Report file names and counts only; never echo the matched text.
    const summary = hits.map((h) => `${h.file}: ${h.hits.length} term(s)`);
    expect(summary, 'denylisted terms found in tracked files').toEqual([]);
  });

  it('fails when a tracked file contains a planted denylisted term', () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'denylist-'));
    try {
      const git = (...args: string[]) => execFileSync('git', args, { cwd: dir });
      git('init', '-q');
      writeFileSync(path.join(dir, 'clean.md'), 'Annual summary of the quarter.\n');
      writeFileSync(path.join(dir, 'planted.md'), 'Paid to Zephyrine Quastwick on 3/1.\n');
      writeFileSync(path.join(dir, 'untracked-ignored.md'), 'Zephyrine Quastwick\n');
      writeFileSync(path.join(dir, '.gitignore'), 'untracked-ignored.md\n');
      git('add', 'clean.md', 'planted.md', '.gitignore');
      const hits = scanRepo(dir, ['Zephyrine Quastwick', 'Ann']);
      expect(hits.map((h) => h.file)).toEqual(['planted.md']);
      expect(hits[0]!.hits).toEqual([{ term: 'Zephyrine Quastwick', count: 1 }]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('matches whole words case-insensitively', () => {
    expect(termPattern('Ann').test('paid ANN today')).toBe(true);
    expect(termPattern('Ann').test('the annual report')).toBe(false);
    expect(termPattern('Quastwick').test('benquastwick/repo')).toBe(false);
    expect(termPattern('Zephyrine Quastwick').test('Zephyrine  Quastwick')).toBe(true);
    expect(termPattern("O'Quast").test("to o'quast")).toBe(true);
  });
});
