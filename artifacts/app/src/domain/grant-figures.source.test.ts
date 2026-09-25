import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * JPH-30 AC8: one code path per figure. Nothing outside `src/domain` may compute a
 * grant's pacing, received, restricted balance or remaining award itself — pages
 * and services read them from `@/domain/grant-figures` (through
 * `@/services/grant-figures`). The helpers named here are the ones the pages
 * used to call directly; if a new one appears, add it.
 */
const SRC = path.resolve(__dirname, '..');
const SCANNED = ['app', 'components', 'reports', 'narratives', 'services', 'engine', 'seed'];
const ALLOWED = new Set<string>([]);

const FORBIDDEN: Array<{ name: string; pattern: RegExp }> = [
  { name: 'pacing() straight-line call', pattern: /\bpacing\(/ },
  { name: 'matchesReceived() revenue match', pattern: /\bmatchesReceived\(/ },
  { name: 'elapsedBps() elapsed share', pattern: /\belapsedBps\(/ },
  { name: 'projectedAtEnd() projection', pattern: /\bprojectedAtEnd\(/ },
  { name: 'remaining award arithmetic', pattern: /awardAmountCents\s*-\s*/ },
  { name: 'restricted balance arithmetic', pattern: /receivedCents\s*-\s*[a-zA-Z_.]*spent/ },
  {
    name: 'value import of @/domain/pacing',
    pattern: /^import\s+(?!type\b)[^;]*from '@\/domain\/pacing'/m,
  },
  {
    name: 'value import of @/domain/received',
    pattern: /^import\s+(?!type\b)[^;]*from '@\/domain\/received'/m,
  },
];

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name)) out.push(full);
  }
  return out;
}

describe('one set of grant figures (JPH-30 AC8)', () => {
  const files = SCANNED.flatMap((d) => walk(path.join(SRC, d)));

  it('scans the app, components, reports, narratives and services', () => {
    expect(files.length).toBeGreaterThan(50);
  });

  it('no page or service computes pacing, received, restricted balance or remaining award itself', () => {
    const hits: string[] = [];
    for (const file of files) {
      const rel = path.relative(SRC, file);
      if (ALLOWED.has(rel)) continue;
      const text = readFileSync(file, 'utf8');
      for (const f of FORBIDDEN) if (f.pattern.test(text)) hits.push(`${rel}: ${f.name}`);
    }
    expect(hits).toEqual([]);
  });

  it('the domain module itself is where those helpers are used', () => {
    const text = readFileSync(path.join(SRC, 'domain/grant-figures.ts'), 'utf8');
    expect(text).toMatch(/\bpacing\(/);
    expect(text).toMatch(/\bmatchesReceived\(/);
    expect(text).toMatch(/receivedCents - totalSpent/);
  });
});
