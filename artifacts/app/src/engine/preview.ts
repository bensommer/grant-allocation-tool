/**
 * Server-rendered rule previews (JPH-9 / JPH-10).
 *
 * The preview runs the real engine over the date range with the candidate rule
 * inserted into (or replacing, when editing) the current configuration, then
 * counts the pieces the candidate actually won. So it honours priority,
 * ties, effective windows, grant periods and explicit budget-line targets —
 * the total shown equals what the rule contributes after a recompute.
 */
import type { Matchers } from '@/domain/matchers';
import { prisma } from '@/lib/db';
import { allocate, type EngineAllocationRule, type EngineCrosswalkRule } from './core';
import { loadEngineConfig, loadEngineLines } from './recompute';

export const PREVIEW_RULE_ID = '__preview__';

export interface PreviewLine {
  sourceLineId: string;
  txnDate: Date;
  docNumber: string | null;
  account: string;
  className: string | null;
  party: string | null;
  description: string | null;
  programCode: string | null;
  amountCents: number;
}

export interface PreviewResult {
  count: number;
  totalCents: number;
  sample: PreviewLine[];
  /** Pieces the candidate matched but lost or tied on priority. */
  contested: number;
}

export type PreviewCandidate =
  | {
      kind: 'crosswalk';
      matchers: Matchers;
      grantBudgetLineId: string | null;
      priority: number;
      /** existing rule being edited; it is replaced in the simulated config */
      ruleId?: string;
    }
  | {
      kind: 'allocation';
      matchers: Matchers;
      priority: number;
      effectiveFrom?: Date | null;
      effectiveTo?: Date | null;
      ruleId?: string;
      method?: 'fixed_pct' | 'ratio_of_driver';
      driverKey?: string | null;
      targets?: EngineAllocationRule['targets'];
    };

export async function previewRule(
  orgId: string,
  candidate: PreviewCandidate,
  range: { from: Date; to: Date },
  sampleSize = 25,
): Promise<PreviewResult> {
  const [{ lines: all }, config] = await Promise.all([
    loadEngineLines(orgId),
    loadEngineConfig(orgId),
  ]);
  const lines = all.filter((l) => l.txnDate >= range.from && l.txnDate <= range.to);

  if (candidate.kind === 'crosswalk') {
    const rule: EngineCrosswalkRule = {
      id: PREVIEW_RULE_ID,
      matchers: candidate.matchers,
      grantBudgetLineId: candidate.grantBudgetLineId ?? '',
      priority: candidate.priority,
      active: true,
    };
    config.crosswalkRules = [
      ...config.crosswalkRules.filter((r) => r.id !== candidate.ruleId),
      rule,
    ];
    if (!candidate.grantBudgetLineId) {
      // No target yet: pretend an always-open budget line so period filtering does not hide matches.
      config.budgetLines.push({ id: '', grantId: PREVIEW_RULE_ID, programId: null });
      config.grants.push({
        id: PREVIEW_RULE_ID,
        startDate: new Date(0),
        endDate: new Date('2999-12-31'),
        status: 'active',
      });
    }
  } else {
    const targets =
      candidate.targets && candidate.targets.length > 0
        ? candidate.targets
        : // Any single valid target: we only count which pieces the rule wins, not how they split.
          [
            {
              sortOrder: 0,
              programId: config.programs[0]?.id ?? null,
              grantBudgetLineId: null,
              shareBps: 10000,
            },
          ];
    const rule: EngineAllocationRule = {
      id: PREVIEW_RULE_ID,
      matchers: { ...candidate.matchers, programIds: undefined },
      method: candidate.method ?? 'fixed_pct',
      driverKey: candidate.driverKey ?? null,
      priority: candidate.priority,
      effectiveFrom: candidate.effectiveFrom ?? null,
      effectiveTo: candidate.effectiveTo ?? null,
      active: true,
      targets,
    };
    config.allocationRules = [
      ...config.allocationRules.filter((r) => r.id !== candidate.ruleId),
      rule,
    ];
  }

  const result = allocate(lines, config);
  const won = result.pieces.filter(
    (p) =>
      (candidate.kind === 'crosswalk' ? p.crosswalkRuleId : p.allocationRuleId) === PREVIEW_RULE_ID,
  );
  const contested = result.pieces.filter((p) => p.conflictRuleIds.includes(PREVIEW_RULE_ID)).length;

  // For allocation rules the interesting unit is the source line, not the split piece.
  const hits =
    candidate.kind === 'allocation'
      ? [...new Set(won.map((p) => p.sourceLineId))].map((id) => ({
          sourceLineId: id,
          programId: null as string | null,
          amountCents: lines.find((l) => l.id === id)!.amountCents,
        }))
      : won.map((p) => ({
          sourceLineId: p.sourceLineId,
          programId: p.programId,
          amountCents: p.amountCents,
        }));

  const sampleHits = hits.slice(0, sampleSize);
  const [rows, programs] = await Promise.all([
    prisma.transactionLine.findMany({
      where: { id: { in: [...new Set(sampleHits.map((h) => h.sourceLineId))] } },
      include: {
        account: true,
        class: true,
        party: true,
        transaction: { include: { party: true } },
      },
    }),
    prisma.program.findMany({ where: { orgId }, select: { id: true, code: true } }),
  ]);
  const rowById = new Map(rows.map((r) => [r.id, r]));
  const codeOf = new Map(programs.map((p) => [p.id, p.code]));
  const sample: PreviewLine[] = sampleHits.map((h) => {
    const r = rowById.get(h.sourceLineId)!;
    return {
      sourceLineId: r.id,
      txnDate: r.transaction.txnDate,
      docNumber: r.transaction.docNumber,
      account: r.account.number ? `${r.account.number} ${r.account.name}` : r.account.name,
      className: r.class?.name ?? null,
      party: r.party?.displayName ?? r.transaction.party?.displayName ?? null,
      description: r.description ?? r.transaction.memo,
      programCode: h.programId ? (codeOf.get(h.programId) ?? null) : null,
      amountCents: h.amountCents,
    };
  });
  return {
    count: hits.length,
    totalCents: hits.reduce((a, h) => a + h.amountCents, 0),
    sample,
    contested,
  };
}
