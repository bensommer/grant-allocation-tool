/**
 * JPH-28 D1 — automatic recalculation: the per-org lock (AC3) and the failure path (AC2).
 * Uses the demo fixture like the recompute pipeline test; the engine is untouched, the tests
 * inject a slow or a buggy compute function through the existing seam.
 */
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '@/lib/db';
import { CsvDataSource } from '@/datasource/csv/adapter';
import { FULL_RANGE, runImport } from '@/datasource/import-service';
import { seedDemoOverlay } from '@/seed/demo-overlay';
import { allocate } from '@/engine/core';
import { recomputeAfterMutation } from '@/services/recompute-queue';
import { createTestOrg, resetDatabase } from './helpers';

const DEMO = path.resolve(__dirname, '../../fixtures/demo');
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe('automatic recalculation (JPH-28 D1)', () => {
  let orgId: string;
  beforeAll(async () => {
    await resetDatabase();
    orgId = await createTestOrg();
    await runImport(orgId, new CsvDataSource({ dir: DEMO }), FULL_RANGE);
    await seedDemoOverlay(orgId, path.join(DEMO, 'overlay'));
  });
  afterAll(() => prisma.$disconnect());

  it('AC1: a mutation-triggered calculation records trigger=auto and the cause, and becomes current', async () => {
    const out = await recomputeAfterMutation(orgId, { trigger: 'auto', cause: 'crosswalk rule saved' });
    expect(out.kind).toBe('ran');
    const run = await prisma.computeRun.findFirstOrThrow({ where: { orgId, isCurrent: true } });
    expect(run.trigger).toBe('auto');
    expect(run.cause).toBe('crosswalk rule saved');
    expect(run.stale).toBe(false);
    const lock = await prisma.recomputeLock.findUniqueOrThrow({ where: { orgId } });
    expect(lock.running).toBe(false);
    expect(lock.pending).toBe(false);
  });

  it('AC3: two mutations within 100 ms produce at most two runs and never two concurrent runs', async () => {
    const slow: typeof allocate = (lines, config) => {
      // Hold the engine busy long enough for the second caller to arrive and queue behind.
      const until = Date.now() + 300;
      while (Date.now() < until) {
        /* spin */
      }
      return allocate(lines, config);
    };
    const before = await prisma.computeRun.count({ where: { orgId } });
    let maxRunning = 0;
    let sampling = true;
    const sampler = (async () => {
      while (sampling) {
        maxRunning = Math.max(
          maxRunning,
          await prisma.computeRun.count({ where: { orgId, status: 'running' } }),
        );
        await sleep(10);
      }
    })();
    const first = recomputeAfterMutation(orgId, { trigger: 'auto', cause: 'budget line saved', compute: slow });
    await sleep(50);
    const second = recomputeAfterMutation(orgId, { trigger: 'auto', cause: 'effort count saved', compute: slow });
    const outcomes = await Promise.all([first, second]);
    sampling = false;
    await sampler;
    expect(outcomes.map((o) => o.kind).sort()).toEqual(['coalesced', 'ran']);
    expect(maxRunning).toBe(1);
    const after = await prisma.computeRun.count({ where: { orgId } });
    expect(after - before).toBeLessThanOrEqual(2);
    expect(after - before).toBeGreaterThanOrEqual(1);
    // The follow-up run carries the queued caller's cause, so the log explains both writes.
    const latest = await prisma.computeRun.findFirstOrThrow({
      where: { orgId },
      orderBy: { startedAt: 'desc' },
    });
    expect(latest.isCurrent).toBe(true);
    expect(latest.trigger).toBe('auto');
    expect(['budget line saved', 'effort count saved']).toContain(latest.cause);
    const lock = await prisma.recomputeLock.findUniqueOrThrow({ where: { orgId } });
    expect(lock.running).toBe(false);
    expect(lock.pending).toBe(false);
  });

  it('AC3: a burst of five mutations coalesces into at most two runs', async () => {
    const before = await prisma.computeRun.count({ where: { orgId } });
    await Promise.all(
      Array.from({ length: 5 }, (_, i) =>
        recomputeAfterMutation(orgId, { trigger: 'auto', cause: `decision ${i}` }),
      ),
    );
    const after = await prisma.computeRun.count({ where: { orgId } });
    expect(after - before).toBeLessThanOrEqual(2);
    const running = await prisma.computeRun.count({ where: { orgId, status: 'running' } });
    expect(running).toBe(0);
  });

  it('AC2: an invariant failure records a failed run with its cause, keeps the previous run current and releases the lock', async () => {
    const current = await prisma.computeRun.findFirstOrThrow({ where: { orgId, isCurrent: true } });
    const buggy: typeof allocate = (lines, config) => {
      const r = allocate(lines, config);
      r.pieces[0]!.amountCents += 1;
      return r;
    };
    const out = await recomputeAfterMutation(orgId, {
      trigger: 'auto',
      cause: 'allocation rule saved',
      compute: buggy,
    });
    expect(out.kind).toBe('ran');
    if (out.kind !== 'ran') throw new Error('unreachable');
    expect(out.result.status).toBe('failed');
    const failed = await prisma.computeRun.findUniqueOrThrow({ where: { id: out.result.runId } });
    expect(failed.status).toBe('failed');
    expect(failed.isCurrent).toBe(false);
    expect(failed.trigger).toBe('auto');
    expect(failed.cause).toBe('allocation rule saved');
    const still = await prisma.computeRun.findFirstOrThrow({ where: { orgId, isCurrent: true } });
    expect(still.id).toBe(current.id);
    const lock = await prisma.recomputeLock.findUniqueOrThrow({ where: { orgId } });
    expect(lock.running).toBe(false);
    // The next mutation recalculates normally.
    const next = await recomputeAfterMutation(orgId, { trigger: 'auto', cause: 'allocation rule saved' });
    expect(next.kind).toBe('ran');
    if (next.kind !== 'ran') throw new Error('unreachable');
    expect(next.result.status).toBe('succeeded');
  });

  it('a crashed holder (expired lock) does not block the next mutation', async () => {
    await prisma.recomputeLock.update({
      where: { orgId },
      data: { running: true, lockedAt: new Date(Date.now() - 10 * 60_000) },
    });
    const out = await recomputeAfterMutation(orgId, { trigger: 'manual', cause: 'Recalculate now' });
    expect(out.kind).toBe('ran');
    const lock = await prisma.recomputeLock.findUniqueOrThrow({ where: { orgId } });
    expect(lock.running).toBe(false);
  });
});
