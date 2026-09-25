import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';

/**
 * Privacy guardrails for the pilot fixtures (JPH-20).
 *
 * `fixtures/private/denylist.txt` lists the real names that must never appear
 * in anything committed. The file itself is git-ignored; when it is present
 * (the pilot maintainer's machine, CI with the file mounted) the guard test
 * scans every tracked file for the terms.
 */

export const DENYLIST_PATH = path.join('fixtures', 'private', 'denylist.txt');
export const PSEUDONYMS_PATH = path.join('fixtures', 'private', 'pseudonyms.json');

export function loadDenylist(file: string): string[] {
  return readFileSync(file, 'utf8')
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('#'));
}

/**
 * Case-insensitive, whole-word match: a term like "Ann" must not fire on
 * "annual", and a surname must not fire inside a git handle that contains it.
 * Spaces inside a term match any whitespace.
 */
export function termPattern(term: string): RegExp {
  const escaped = term
    .trim()
    .split(/\s+/)
    .map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    .join('\\s+');
  return new RegExp(`(?<![\\p{L}\\p{N}])${escaped}(?![\\p{L}\\p{N}])`, 'iu');
}

export interface DenylistHit {
  term: string;
  /** Number of matches; the matched text is never returned. */
  count: number;
}

export function findDenylistedTerms(text: string, denylist: string[]): DenylistHit[] {
  const hits: DenylistHit[] = [];
  for (const term of denylist) {
    const re = new RegExp(termPattern(term).source, 'giu');
    const count = text.match(re)?.length ?? 0;
    if (count > 0) hits.push({ term, count });
  }
  return hits;
}

export interface FileHit {
  file: string;
  hits: DenylistHit[];
}

const BINARY_EXT = new Set([
  '.png',
  '.jpg',
  '.jpeg',
  '.gif',
  '.webp',
  '.ico',
  '.woff',
  '.woff2',
  '.ttf',
  '.pdf',
  '.zip',
  '.xlsx',
  '.gz',
]);
const MAX_BYTES = 5 * 1024 * 1024;

/** Every file git knows about under `repoDir` (tracked or staged), relative to it. */
export function listTrackedFiles(repoDir: string): string[] {
  const out = execFileSync(
    'git',
    ['ls-files', '-z', '--cached', '--others', '--exclude-standard'],
    {
      cwd: repoDir,
      maxBuffer: 64 * 1024 * 1024,
    },
  );
  return out.toString('utf8').split('\0').filter(Boolean);
}

export function scanFiles(repoDir: string, files: string[], denylist: string[]): FileHit[] {
  const results: FileHit[] = [];
  for (const rel of files) {
    const abs = path.join(repoDir, rel);
    if (BINARY_EXT.has(path.extname(rel).toLowerCase())) continue;
    if (!existsSync(abs)) continue;
    const stat = statSync(abs);
    if (!stat.isFile() || stat.size > MAX_BYTES) continue;
    const text = readFileSync(abs, 'utf8');
    const hits = findDenylistedTerms(text, denylist);
    if (hits.length > 0) results.push({ file: rel, hits });
  }
  return results;
}

export function scanRepo(repoDir: string, denylist: string[]): FileHit[] {
  return scanFiles(repoDir, listTrackedFiles(repoDir), denylist);
}
