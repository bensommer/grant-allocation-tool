/**
 * Thin DB wrapper around the pure engine core (JPH-10).
 *
 * recompute(orgId):
 *   1. load source lines (expense + income, not soft-deleted) and overlay config
 *   2. create ComputeRun(running)
 *   3. run allocate() → pieces
 *   4. bulk insert AllocatedLine
 *   5. verify Σ pieces == source per line in SQL; on failure mark run failed and
 *      leave the previous current run untouched
 *   6. promote: previous current → superseded, new → succeeded + isCurrent
 *
 * Runs synchronously (demo-sized data). A background runner can wrap this
 * function later without changing its contract.
 */
import { createHash } from 'node:crypto';
import type { Prisma } from '@/generated/prisma/client';
import { prisma } from '@/lib/db';
import { toJson } from '@/lib/audit';
import { parseMatchers } from '@/domain/matchers';
import { assertAllocationBalanced, AllocationImbalanceError } from '@/domain/invariants';
import {
  allocate,
  type AccountKind,
  type EngineConfig,
  type EngineLine,
  type EngineResult,
} from './core';

export type ComputeFn = (lines: EngineLine[], config: EngineConfig) => EngineResult;

export interface RecomputeResult {
  runId: string;
  status: 'succeeded' | 'failed';
  durationMs: number;
  stats?: EngineResult['stats'];
  warnings: number;
  error?: string;
}

export function accountKind(type: string): AccountKind {
  if (type === 'Expense' || type === 'COGS' || type === 'OtherExpense') return 'expense';
  if (type === 'Income' || type === 'OtherIncome') return 'income';
  return 'other';
}

export async function loadEngineConfig(orgId: string): Promise<EngineConfig> {
  const [programs, allocationRules, crosswalkRules, budgetLines, grants, drivers] =
    await Promise.all([
      prisma.program.findMany({ where: { orgId }, orderBy: { id: 'asc' } }),
      prisma.allocationRule.findMany({
        where: { orgId },
        include: { targets: { orderBy: { sortOrder: 'asc' } } },
        orderBy: { id: 'asc' },
      }),
      prisma.crosswalkRule.findMany({ where: { orgId }, orderBy: { id: 'asc' } }),
      prisma.grantBudgetLine.findMany({ where: { orgId }, orderBy: { id: 'asc' } }),
      prisma.grant.findMany({ where: { orgId }, orderBy: { id: 'asc' } }),
      prisma.allocationDriverValue.findMany({ where: { orgId }, orderBy: { id: 'asc' } }),
    ]);
  return {
    programs: programs.map((p) => ({
      id: p.id,
      matchClassIds: [...p.matchClassIds].sort(),
      active: p.active,
    })),
    allocationRules: allocationRules.map((r) => ({
      id: r.id,
      matchers: parseMatchers(r.matchers),
      method: r.method,
      driverKey: r.driverKey,
      priority: r.priority,
      effectiveFrom: r.effectiveFrom,
      effectiveTo: r.effectiveTo,
      active: r.active,
      targets: r.targets.map((t) => ({
        sortOrder: t.sortOrder,
        programId: t.programId,
        grantBudgetLineId: t.grantBudgetLineId,
        shareBps: t.shareBps,
      })),
    })),
    crosswalkRules: crosswalkRules.map((r) => ({
      id: r.id,
      matchers: parseMatchers(r.matchers),
      grantBudgetLineId: r.grantBudgetLineId,
      priority: r.priority,
      active: r.active,
    })),
    budgetLines: budgetLines.map((b) => ({ id: b.id, grantId: b.grantId, programId: b.programId })),
    grants: grants.map((g) => ({
      id: g.id,
      startDate: g.startDate,
      endDate: g.endDate,
      status: g.status,
    })),
    driverValues: new Map(
      drivers.map((d) => [`${d.driverKey}|${d.period}|${d.programId}`, d.value]),
    ),
  };
}

/** Stable hash of everything that influences the allocation result besides source data. */
export function configHash(config: EngineConfig): string {
  const canonical = JSON.stringify({
    programs: config.programs,
    allocationRules: config.allocationRules,
    crosswalkRules: config.crosswalkRules,
    budgetLines: config.budgetLines,
    grants: config.grants,
    driverValues: [...config.driverValues.entries()].sort(([a], [b]) => a.localeCompare(b)),
  });
  return createHash('sha256').update(canonical).digest('hex').slice(0, 16);
}

export async function loadEngineLines(
  orgId: string,
): Promise<{ lines: EngineLine[]; batchIds: string[] }> {
  const rows = await prisma.transactionLine.findMany({
    where: {
      orgId,
      transaction: { deletedAt: null },
      account: { type: { in: ['Expense', 'COGS', 'OtherExpense', 'Income', 'OtherIncome'] } },
    },
    include: {
      account: { select: { number: true, type: true } },
      transaction: { select: { txnDate: true, partyId: true, memo: true, importBatchId: true } },
    },
    orderBy: { id: 'asc' },
  });
  const batchIds = [...new Set(rows.map((r) => r.transaction.importBatchId))].sort();
  return {
    batchIds,
    lines: rows.map((r) => ({
      id: r.id,
      accountId: r.accountId,
      accountNumber: r.account.number,
      accountKind: accountKind(r.account.type),
      classId: r.classId,
      locationId: r.locationId,
      partyId: r.partyId,
      txnPartyId: r.transaction.partyId,
      description: r.description,
      memo: r.transaction.memo,
      txnDate: r.transaction.txnDate,
      amountCents: r.amountCents,
    })),
  };
}

export async function recompute(
  orgId: string,
  opts: { compute?: ComputeFn; actor?: string } = {},
): Promise<RecomputeResult> {
  const started = Date.now();
  const compute = opts.compute ?? allocate;
  const [config, { lines, batchIds }] = await Promise.all([
    loadEngineConfig(orgId),
    loadEngineLines(orgId),
  ]);
  const hash = configHash(config);
  const run = await prisma.computeRun.create({
    data: { orgId, status: 'running', configHash: hash, sourceBatchIds: batchIds },
  });

  const fail = async (message: string): Promise<RecomputeResult> => {
    await prisma.computeRun.update({
      where: { id: run.id },
      data: {
        status: 'failed',
        finishedAt: new Date(),
        checks: toJson([{ name: 'sum_per_source_line', ok: false, detail: message }]),
      },
    });
    return {
      runId: run.id,
      status: 'failed',
      durationMs: Date.now() - started,
      warnings: 0,
      error: message,
    };
  };

  let result: EngineResult;
  try {
    result = compute(lines, config);
  } catch (e) {
    return fail(`Engine error: ${(e as Error).message}`);
  }

  const CHUNK = 2000;
  for (let i = 0; i < result.pieces.length; i += CHUNK) {
    const data: Prisma.AllocatedLineCreateManyInput[] = result.pieces
      .slice(i, i + CHUNK)
      .map((p) => ({ orgId, computeRunId: run.id, ...p }));
    await prisma.allocatedLine.createMany({ data });
  }

  try {
    await assertAllocationBalanced(run.id);
    // Every loaded line must have at least one piece.
    const covered = await prisma.allocatedLine.groupBy({
      by: ['sourceLineId'],
      where: { computeRunId: run.id },
    });
    if (covered.length !== lines.length)
      throw new AllocationImbalanceError(
        lines
          .filter((l) => !covered.some((c) => c.sourceLineId === l.id))
          .map((l) => ({ sourceLineId: l.id, expected: l.amountCents, actual: 0 })),
      );
  } catch (e) {
    return fail((e as Error).message);
  }

  await prisma.$transaction(async (tx) => {
    await tx.computeRun.updateMany({
      where: { orgId, isCurrent: true, id: { not: run.id } },
      data: { isCurrent: false, status: 'superseded' },
    });
    await tx.computeRun.update({
      where: { id: run.id },
      data: {
        status: 'succeeded',
        isCurrent: true,
        stale: false,
        finishedAt: new Date(),
        warnings: toJson(result.warnings),
        checks: toJson([
          {
            name: 'sum_per_source_line',
            ok: true,
            detail: `${lines.length} lines, ${result.pieces.length} pieces`,
          },
          { name: 'stats', ok: true, detail: result.stats },
        ]),
      },
    });
    await tx.auditEvent.create({
      data: {
        orgId,
        entity: 'ComputeRun',
        entityId: run.id,
        action: 'create',
        after: toJson({ configHash: hash, stats: result.stats }),
        actor: opts.actor ?? 'local-user',
      },
    });
  });
  return {
    runId: run.id,
    status: 'succeeded',
    durationMs: Date.now() - started,
    stats: result.stats,
    warnings: result.warnings.length,
  };
}

export async function currentRun(orgId: string) {
  return prisma.computeRun.findFirst({ where: { orgId, isCurrent: true } });
}
