/**
 * JPH-26 baseline collector. Captured on main before Phase B touched anything and committed as
 * tests/fixtures/jph26-baseline.json; the AC1 and AC8 tests replay the same seeds and compare.
 *
 * - `sentences` — the exact "Matches when" text the list pages showed for every seeded rule.
 * - `demoAllocated` — AllocatedLine cents per grant › budget line for the JPH-7 demo run.
 * - `pilotGrantLines` — GrantLineResult cents per grant › working line › state for the pilot run.
 */
import path from 'node:path';
import { prisma } from '@/lib/db';
import { CsvDataSource } from '@/datasource/csv/adapter';
import { FULL_RANGE, runImport } from '@/datasource/import-service';
import { parseMatchers } from '@/domain/matchers';
import { currentRun, recompute } from '@/engine/recompute';
import { seedDemoOverlay } from '@/seed/demo-overlay';
import { seedPilot } from '@/seed/pilot';
import { createTestOrg, resetDatabase } from './helpers';

export const BASELINE_FILE = path.resolve(process.cwd(), 'tests/fixtures/jph26-baseline.json');
export const DEMO_DIR = path.resolve(process.cwd(), 'fixtures/demo');
export const PILOT_SEED = path.resolve(process.cwd(), 'fixtures/pilot/seed.json');

export interface Baseline {
  demo: { sentences: Record<string, string>; allocated: Record<string, number> };
  pilot: { sentences: Record<string, string>; grantLines: Record<string, number> };
}

export type SentenceFn = (
  rule: { matchers: unknown },
  ctx: { orgId: string },
) => Promise<string> | string;

const sorted = <T>(o: Record<string, T>): Record<string, T> =>
  Object.fromEntries(Object.entries(o).sort(([a], [b]) => a.localeCompare(b)));

async function ruleSentences(orgId: string, sentence: SentenceFn) {
  const rules = await prisma.crosswalkRule.findMany({
    where: { orgId },
    include: {
      grant: { select: { name: true } },
      grantBudgetLine: { select: { code: true, grant: { select: { name: true } } } },
      targetActivity: { select: { name: true } },
    },
  });
  const out: Record<string, string> = {};
  for (const r of rules) {
    const grant = r.grant?.name ?? r.grantBudgetLine?.grant.name ?? '(none)';
    const key = `${grant}|${r.dimension}|${r.grantBudgetLine?.code ?? ''}|${r.targetActivity?.name ?? ''}|${r.targetCategoryKey ?? ''}|${r.name ?? ''}|${r.priority}`;
    if (key in out) throw new Error(`duplicate rule key ${key}`);
    out[key] = await sentence({ matchers: parseMatchers(r.matchers) }, { orgId });
  }
  return sorted(out);
}

export async function seedDemo(): Promise<string> {
  await resetDatabase();
  const orgId = await createTestOrg();
  const r = await runImport(orgId, new CsvDataSource({ dir: DEMO_DIR }), FULL_RANGE);
  if (r.status !== 'succeeded')
    throw new Error(`demo import ${r.status}: ${JSON.stringify(r.errors?.slice(0, 3))}`);
  await seedDemoOverlay(orgId, path.join(DEMO_DIR, 'overlay'));
  const run = await recompute(orgId);
  if (run.status !== 'succeeded') throw new Error(`demo recompute ${run.status}: ${run.error}`);
  return orgId;
}

export async function seedPilotOrg(): Promise<string> {
  await resetDatabase();
  const orgId = await createTestOrg();
  const summary = await seedPilot(orgId, PILOT_SEED);
  if (!summary.grants.every((g) => g.imported)) throw new Error('pilot import incomplete');
  const run = await recompute(orgId);
  if (run.status !== 'succeeded') throw new Error(`pilot recompute ${run.status}: ${run.error}`);
  return orgId;
}

export async function demoAllocated(orgId: string): Promise<Record<string, number>> {
  const run = await currentRun(orgId);
  const rows = await prisma.allocatedLine.findMany({
    where: { orgId, computeRunId: run!.id },
    select: {
      amountCents: true,
      grantBudgetLine: { select: { code: true, grant: { select: { name: true } } } },
    },
  });
  const out: Record<string, number> = {};
  for (const r of rows) {
    const key = r.grantBudgetLine
      ? `${r.grantBudgetLine.grant.name}|${r.grantBudgetLine.code}`
      : '(no budget line)';
    out[key] = (out[key] ?? 0) + r.amountCents;
  }
  out['(rows)'] = rows.length;
  return sorted(out);
}

export async function pilotGrantLines(orgId: string): Promise<Record<string, number>> {
  const run = await currentRun(orgId);
  const rows = await prisma.grantLineResult.findMany({
    where: { orgId, computeRunId: run!.id },
    select: {
      amountCents: true,
      state: true,
      grant: { select: { name: true } },
      budgetLine: { select: { code: true } },
    },
  });
  const out: Record<string, number> = {};
  for (const r of rows) {
    const key = `${r.grant.name}|${r.budgetLine?.code ?? '(none)'}|${r.state}`;
    out[key] = (out[key] ?? 0) + r.amountCents;
  }
  out['(rows)'] = rows.length;
  return sorted(out);
}

export async function collectBaseline(sentence: SentenceFn): Promise<Baseline> {
  const demoOrg = await seedDemo();
  const demo = {
    sentences: await ruleSentences(demoOrg, sentence),
    allocated: await demoAllocated(demoOrg),
  };
  const pilotOrg = await seedPilotOrg();
  const pilot = {
    sentences: await ruleSentences(pilotOrg, sentence),
    grantLines: await pilotGrantLines(pilotOrg),
  };
  return { demo, pilot };
}
