import { prisma } from '@/lib/db';
import {
  recompute,
  type ComputeFn,
  type GrantStageFn,
  type RecomputeResult,
} from '@/engine/recompute';

/**
 * Automatic recalculation after a mutation (JPH-28 D1).
 *
 * Every server action that changes something the engine reads calls `recomputeAfterMutation`
 * once its write has committed. The engine itself is untouched: this module only decides *when*
 * `recompute` runs and makes sure two calculations for one org never overlap.
 *
 * Concurrency: one `RecomputeLock` row per org. The first caller flips `running` and holds the
 * lock for the whole run. A caller that arrives while a run is in progress sets `pending` (with
 * its cause) and waits; the holder notices the flag when it finishes and runs once more, so a
 * burst of N mutations produces at most two calculations and never two at the same time. Callers
 * return only after the calculation covering their write has finished (or failed), so the
 * redirect that follows lands on a page whose header already reads "Updated just now".
 *
 * Failure: a run that trips an invariant is recorded as `failed` by the engine; the previous
 * run stays current and the lock is released either way.
 */

export type RecomputeTrigger = 'manual' | 'auto' | 'import';

export interface RecomputeRequest {
  trigger: RecomputeTrigger;
  /** Human-readable reason shown in the activity log, e.g. "crosswalk rule saved". */
  cause: string;
  actor?: string;
  /** Test seams, forwarded to the engine. */
  compute?: ComputeFn;
  grantStage?: GrantStageFn;
}

export type RecomputeOutcome =
  /** This caller ran the calculation (possibly twice, when another caller queued behind it). */
  | { kind: 'ran'; result: RecomputeResult }
  /** Another caller held the lock and ran again on this caller's behalf. */
  | { kind: 'coalesced'; result: RecomputeResult | null };

/** A run older than this with the lock still held is treated as crashed and taken over. */
export const LOCK_EXPIRY_MS = 5 * 60_000;
const POLL_MS = 50;
const WAIT_TIMEOUT_MS = 120_000;

async function ensureLockRow(orgId: string): Promise<void> {
  try {
    await prisma.recomputeLock.upsert({ where: { orgId }, create: { orgId }, update: {} });
  } catch (e) {
    // Two first-ever callers can race the insert; the loser can carry on with the winner's row.
    if ((e as { code?: string }).code !== 'P2002') throw e;
  }
}

async function tryAcquire(orgId: string): Promise<boolean> {
  const now = new Date();
  const r = await prisma.recomputeLock.updateMany({
    where: {
      orgId,
      OR: [{ running: false }, { lockedAt: { lt: new Date(now.getTime() - LOCK_EXPIRY_MS) } }],
    },
    data: { running: true, lockedAt: now, pending: false, pendingCause: null },
  });
  return r.count === 1;
}

/** Ask the current holder to run once more; false when nobody holds the lock any more. */
async function queueBehindHolder(orgId: string, cause: string): Promise<boolean> {
  const r = await prisma.recomputeLock.updateMany({
    where: { orgId, running: true },
    data: { pending: true, pendingCause: cause },
  });
  return r.count === 1;
}

/**
 * Release unless a follow-up was requested; in that case keep the lock, clear the request and
 * hand its cause back so the holder runs again.
 */
async function releaseOrTakePending(orgId: string): Promise<string | null> {
  const released = await prisma.recomputeLock.updateMany({
    where: { orgId, running: true, pending: false },
    data: { running: false, lockedAt: null },
  });
  if (released.count === 1) return null;
  const lock = await prisma.recomputeLock.findUniqueOrThrow({ where: { orgId } });
  await prisma.recomputeLock.update({
    where: { orgId },
    data: { pending: false, pendingCause: null },
  });
  return lock.pendingCause ?? 'queued change';
}

async function waitUntilReleased(orgId: string): Promise<void> {
  const deadline = Date.now() + WAIT_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const lock = await prisma.recomputeLock.findUnique({ where: { orgId } });
    if (!lock || !lock.running) return;
    if (lock.lockedAt && lock.lockedAt.getTime() < Date.now() - LOCK_EXPIRY_MS) return;
    await new Promise((r) => setTimeout(r, POLL_MS));
  }
  throw new Error('Timed out waiting for the calculation to finish');
}

async function runHoldingLock(orgId: string, req: RecomputeRequest): Promise<RecomputeResult> {
  let cause: string | null = req.cause;
  let last: RecomputeResult | undefined;
  try {
    while (cause !== null) {
      last = await recompute(orgId, {
        trigger: req.trigger,
        cause,
        actor: req.actor,
        compute: req.compute,
        grantStage: req.grantStage,
      });
      cause = await releaseOrTakePending(orgId);
    }
  } catch (e) {
    // Only an unexpected error (DB down, bug) reaches here — the engine records its own
    // failures. Give the lock back so the next mutation can try again.
    await prisma.recomputeLock
      .updateMany({ where: { orgId, running: true }, data: { running: false, lockedAt: null } })
      .catch(() => undefined);
    throw e;
  }
  return last!;
}

/**
 * Run (or queue) a calculation for the org and resolve once the calculation that covers the
 * caller's write has finished.
 */
export async function recomputeAfterMutation(
  orgId: string,
  req: RecomputeRequest,
): Promise<RecomputeOutcome> {
  await ensureLockRow(orgId);
  for (;;) {
    if (await tryAcquire(orgId)) return { kind: 'ran', result: await runHoldingLock(orgId, req) };
    if (await queueBehindHolder(orgId, req.cause)) {
      await waitUntilReleased(orgId);
      const latest = await prisma.computeRun.findFirst({
        where: { orgId },
        orderBy: { startedAt: 'desc' },
      });
      return {
        kind: 'coalesced',
        result: latest
          ? {
              runId: latest.id,
              status: latest.status === 'failed' ? 'failed' : 'succeeded',
              durationMs: latest.finishedAt
                ? latest.finishedAt.getTime() - latest.startedAt.getTime()
                : 0,
              warnings: Array.isArray(latest.warnings) ? latest.warnings.length : 0,
            }
          : null,
      };
    }
    // The holder released between our two checks; try to take the lock ourselves.
  }
}

/** Header chip / checklist: is a calculation running right now? */
export async function isRecomputeRunning(orgId: string): Promise<boolean> {
  const lock = await prisma.recomputeLock.findUnique({ where: { orgId } });
  if (!lock?.running) return false;
  return !(lock.lockedAt && lock.lockedAt.getTime() < Date.now() - LOCK_EXPIRY_MS);
}
