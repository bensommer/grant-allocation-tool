/**
 * JPH-26 AC1 — describeRule reproduces, byte for byte, the "Matches when" text the crosswalk
 * and grant rules list pages showed before Phase B, for every seeded demo crosswalk rule and
 * every seeded pilot grant rule. The expected strings were captured on main before any change
 * (tests/fixtures/jph26-baseline.json); never edit them.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { describeRule } from '@/domain/describe-rule';
import type { Matchers } from '@/domain/matchers';
import { loadLabelMaps } from '@/lib/matcher-labels';
import { BASELINE_FILE, collectBaseline, type Baseline } from './jph26-baseline';

const baseline = JSON.parse(readFileSync(BASELINE_FILE, 'utf8')) as Baseline;

describe('JPH-26 AC1: describeRule list wording matches the pre-phase list pages', () => {
  it('every seeded crosswalk rule and pilot grant rule renders the captured sentence', async () => {
    const labelCache = new Map<string, Awaited<ReturnType<typeof loadLabelMaps>>>();
    const now = await collectBaseline(async (rule, { orgId }) => {
      if (!labelCache.has(orgId)) labelCache.set(orgId, await loadLabelMaps(orgId));
      return describeRule(
        {
          scope: 'all',
          matchers: rule.matchers as Matchers,
          target: null,
          labels: labelCache.get(orgId)!,
        },
        { wording: 'list' },
      ).conditionsText;
    });
    expect(Object.keys(now.demo.sentences)).toHaveLength(6);
    expect(Object.keys(now.pilot.sentences)).toHaveLength(20);
    expect(now.demo.sentences).toEqual(baseline.demo.sentences);
    expect(now.pilot.sentences).toEqual(baseline.pilot.sentences);
  }, 300_000);
});
