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
import type { Prisma, RunTrigger } from '@/generated/prisma/client';
import { prisma } from '@/lib/db';
import { toJson } from '@/lib/audit';
import { reconciliationChecks } from '@/services/reconciliation';
import { lineFingerprint } from '@/services/line-decisions';
import { detectPostedEntries, loadPostedLines } from '@/services/correcting-entries';
import { loadStageSchedules } from '@/services/effort';
import { parseMatchers } from '@/domain/matchers';
import {
  assertAllocationBalanced,
  assertGrantStatesBalanced,
  AllocationImbalanceError,
} from '@/domain/invariants';
import {
  allocate,
  assignGrantLines,
  type AccountKind,
  type EngineConfig,
  type EngineLine,
  type EngineResult,
  type GrantLineDraft,
  type GrantStageConfig,
} from './core';

export type ComputeFn = (lines: EngineLine[], config: EngineConfig) => EngineResult;
export type GrantStageFn = (lines: EngineLine[], config: GrantStageConfig) => GrantLineDraft[];

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
      // Grant-scoped rules (JPH-21) belong to the grant stage, not the program crosswalk.
      prisma.crosswalkRule.findMany({ where: { orgId, grantId: null }, orderBy: { id: 'asc' } }),
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
    crosswalkRules: crosswalkRules
      .filter((r) => r.grantBudgetLineId !== null)
      .map((r) => ({
        id: r.id,
        matchers: parseMatchers(r.matchers),
        grantBudgetLineId: r.grantBudgetLineId!,
        priority: r.priority,
        active: r.active,
      })),
    budgetLines: budgetLines.map((b) => ({
      id: b.id,
      grantId: b.grantId,
      programId: b.programId,
      kind: b.kind,
      activityId: b.activityId,
      categoryKey: b.categoryKey,
    })),
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
      deletedAt: null,
      transaction: { deletedAt: null },
      account: { type: { in: ['Expense', 'COGS', 'OtherExpense', 'Income', 'OtherIncome'] } },
    },
    include: {
      account: { select: { number: true, type: true } },
      transaction: {
        select: {
          txnDate: true,
          partyId: true,
          memo: true,
          importBatchId: true,
          txnType: true,
          docNumber: true,
        },
      },
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
      txnType: r.transaction.txnType,
      docNumber: r.transaction.docNumber,
    })),
  };
}

/**
 * Grant-stage inputs (JPH-21): active memberships, grant rules, budget lines
 * and active decisions with their fingerprints resolved to the loaded lines.
 * A decision whose fingerprint no longer exists (line removed by a re-import)
 * simply has nothing to act on.
 */
export async function loadGrantStageConfig(
  orgId: string,
  lines: EngineLine[],
): Promise<GrantStageConfig> {
  const lineIds = new Set(lines.map((l) => l.id));
  const [grants, memberships, rules, budgetLines, decisions, schedules, postedLines] =
    await Promise.all([
      prisma.grant.findMany({
        where: { orgId, status: { not: 'archived' } },
        select: { id: true },
        orderBy: { id: 'asc' },
      }),
      prisma.grantMembership.findMany({
        where: { orgId, supersededAt: null },
        select: { grantId: true, transactionLineId: true },
      }),
      prisma.crosswalkRule.findMany({
        where: { orgId, grantId: { not: null } },
        orderBy: { id: 'asc' },
      }),
      prisma.grantBudgetLine.findMany({ where: { orgId }, orderBy: { id: 'asc' } }),
      prisma.lineDecision.findMany({
        where: { orgId, supersededAt: null },
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        select: {
          id: true,
          grantId: true,
          fingerprint: true,
          kind: true,
          targetBudgetLineId: true,
          reason: true,
        },
      }),
      loadStageSchedules(orgId),
      loadPostedLines(orgId),
    ]);
  const fingerprints = [...new Set(decisions.map((d) => d.fingerprint))];
  const externalIds = [...new Set(fingerprints.map((f) => f.slice(0, f.lastIndexOf('#'))))];
  const rows =
    externalIds.length === 0
      ? []
      : await prisma.transactionLine.findMany({
          where: {
            orgId,
            deletedAt: null,
            transaction: { deletedAt: null, externalId: { in: externalIds } },
          },
          select: { id: true, lineNumber: true, transaction: { select: { externalId: true } } },
        });
  const lineByFingerprint = new Map<string, string>();
  for (const r of rows) {
    if (lineIds.has(r.id)) lineByFingerprint.set(lineFingerprint(r), r.id);
  }
  return {
    grantIds: grants.map((g) => g.id),
    memberships: memberships
      .filter((m) => lineIds.has(m.transactionLineId))
      .map((m) => ({ grantId: m.grantId, lineId: m.transactionLineId })),
    rules: rules.map((r) => ({
      id: r.id,
      grantId: r.grantId!,
      dimension: r.dimension,
      matchers: parseMatchers(r.matchers),
      priority: r.priority,
      active: r.active,
      targetBudgetLineId: r.grantBudgetLineId,
      targetActivityId: r.targetActivityId,
      targetCategoryKey: r.targetCategoryKey,
    })),
    budgetLines: budgetLines.map((b) => ({
      id: b.id,
      grantId: b.grantId,
      kind: b.kind,
      activityId: b.activityId,
      categoryKey: b.categoryKey,
    })),
    decisions: decisions.flatMap((d, seq) => {
      const lineId = lineByFingerprint.get(d.fingerprint);
      if (!lineId) return [];
      return [
        {
          id: d.id,
          grantId: d.grantId,
          lineId,
          kind: d.kind,
          targetBudgetLineId: d.targetBudgetLineId,
          reason: d.reason,
          seq,
        },
      ];
    }),
    schedules,
    postedLines: postedLines.filter((p) => lineIds.has(p.lineId)),
  };
}

export async function recompute(
  orgId: string,
  opts: {
    compute?: ComputeFn;
    grantStage?: GrantStageFn;
    actor?: string;
    /** JPH-28 D1: what started the calculation (defaults to a manual "Recalculate now"). */
    trigger?: RunTrigger;
    /** JPH-28 D1: why, e.g. "crosswalk rule saved" — shown in the activity log. */
    cause?: string;
  } = {},
): Promise<RecomputeResult> {
  const started = Date.now();
  const compute = opts.compute ?? allocate;
  const grantStage = opts.grantStage ?? assignGrantLines;
  // Correcting entries posted in QuickBooks since the last import/recompute (JPH-22).
  await detectPostedEntries(prisma, orgId);
  const [config, { lines, batchIds }] = await Promise.all([
    loadEngineConfig(orgId),
    loadEngineLines(orgId),
  ]);
  const grantConfig = await loadGrantStageConfig(orgId, lines);
  const hash = configHash(config);
  const run = await prisma.computeRun.create({
    data: {
      orgId,
      status: 'running',
      configHash: hash,
      sourceBatchIds: batchIds,
      trigger: opts.trigger ?? 'manual',
      cause: opts.cause ?? null,
    },
  });

  const fail = async (
    message: string,
    check: 'sum_per_source_line' | 'grant_line_states' = 'sum_per_source_line',
  ): Promise<RecomputeResult> => {
    await prisma.computeRun.update({
      where: { id: run.id },
      data: {
        status: 'failed',
        finishedAt: new Date(),
        checks: toJson([{ name: check, ok: false, detail: message }]),
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

  // --- grant stage (JPH-21) ---------------------------------------------------
  let grantDrafts: GrantLineDraft[];
  try {
    grantDrafts = grantStage(lines, grantConfig);
  } catch (e) {
    return fail(`Grant stage error: ${(e as Error).message}`, 'grant_line_states');
  }
  for (let i = 0; i < grantDrafts.length; i += CHUNK) {
    const data: Prisma.GrantLineResultCreateManyInput[] = grantDrafts
      .slice(i, i + CHUNK)
      .map((d) => ({ orgId, computeRunId: run.id, ...d }));
    await prisma.grantLineResult.createMany({ data });
  }
  try {
    await assertGrantStatesBalanced(run.id);
  } catch (e) {
    return fail((e as Error).message, 'grant_line_states');
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
            detail: `${lines.length} transactions, ${result.pieces.length} allocated amounts`,
          },
          { name: 'stats', ok: true, detail: result.stats },
          { name: 'grant_line_states', ok: true, detail: `${grantDrafts.length} grant lines` },
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
  const checks = await reconciliationChecks(orgId, run.id);
  await prisma.computeRun.update({
    where: { id: run.id },
    data: {
      checks: toJson([
        {
          name: 'sum_per_source_line',
          ok: true,
          status: 'pass',
          detail: `${lines.length} transactions, ${result.pieces.length} allocated amounts`,
          href: `/runs/${run.id}`,
        },
        { name: 'stats', ok: true, detail: result.stats },
        {
          name: 'grant_line_states',
          ok: true,
          status: 'pass',
          detail: `${grantDrafts.length} grant lines, one state each`,
        },
        ...checks.filter((c) => c.name !== 'sum_per_source_line'),
      ]),
    },
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
