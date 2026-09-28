import { describe, expect, it } from 'vitest';
import { freshnessLabel } from './freshness';

const at = new Date('2026-09-25T01:15:00Z');

describe('freshnessLabel (JPH-28 D3)', () => {
  it('reads "Updated just now" under a minute and "Updated N min ago" after', () => {
    expect(freshnessLabel('fresh', at, 5_000)).toBe('Updated just now');
    expect(freshnessLabel('fresh', at, 59_999)).toBe('Updated just now');
    expect(freshnessLabel('fresh', at, 5 * 60_000)).toBe('Updated 5 min ago');
    expect(freshnessLabel('fresh', at, 3 * 3_600_000)).toBe('Updated 3 h ago');
    expect(freshnessLabel('fresh', at, 2 * 86_400_000)).toBe('Updated Sep 25, 2026');
  });
  it('reports updating and failure states', () => {
    expect(freshnessLabel('updating', at, 0)).toBe('Updating…');
    expect(freshnessLabel('failed', at, 0)).toBe('Update failed — see activity log');
    expect(freshnessLabel('none', null, null)).toBe('Not calculated yet');
    expect(freshnessLabel('needs_update', at, 10_000)).toBe('Needs update · last updated just now');
  });
  it('never contains the old "Run <date> UTC" wording', () => {
    for (const state of ['fresh', 'updating', 'failed', 'none', 'needs_update'] as const)
      expect(freshnessLabel(state, at, 90_000)).not.toMatch(/\bRun\b.*UTC/);
  });
});
