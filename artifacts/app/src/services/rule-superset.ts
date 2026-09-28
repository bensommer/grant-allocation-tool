/**
 * Superset warning for the rule builder (JPH-26 B4), built on the JPH-9 conflict model: a rule
 * whose matches are all already taken by rules with a lower (winning) priority never decides
 * anything. We run the real engine twice over the app period — once with the candidate at its
 * own priority, once at priority −1 so it beats everything — and warn when the second run wins
 * transactions but the first wins none. The warning names the rule that takes most of them.
 */
import { allocate, type EngineCrosswalkRule } from '@/engine/core';
import { assignGrantLines, type GrantStageRule } from '@/engine/grant-stage';
import { PREVIEW_RULE_ID } from '@/engine/preview';
import { loadEngineConfig, loadEngineLines, loadGrantStageConfig } from '@/engine/recompute';
import type { Matchers } from '@/domain/matchers';
import type { DateRange } from '@/domain/period';
import { prisma } from '@/lib/db';

export type SupersetCandidate =
  | {
      kind: 'crosswalk';
      matchers: Matchers;
      grantBudgetLineId: string | null;
      priority: number;
      ruleId?: string;
    }
  | {
      grantId: string;
      dimension: 'line' | 'activity' | 'category';
      matchers: Matchers;
      priority: number;
      grantBudgetLineId: string | null;
      targetActivityId: string | null;
      targetCategoryKey: string | null;
      ruleId?: string;
    };

const hasConditions = (m: Matchers) =>
  Object.values(m).some((v) => (Array.isArray(v) ? v.length > 0 : v !== undefined && v !== ''));

function topRule(winners: Iterable<string | null>): string | null {
  const tally = new Map<string, number>();
  for (const id of winners)
    if (id && id !== PREVIEW_RULE_ID) tally.set(id, (tally.get(id) ?? 0) + 1);
  let best: string | null = null;
  for (const [id, n] of tally) if (best === null || n > tally.get(best)!) best = id;
  return best;
}

export function supersetMessage(name: string, priority: number): string {
  return `This rule matches everything rule ${name} (priority ${priority}) matches; it will never win.`;
}

async function message(ruleId: string | null): Promise<string | null> {
  if (!ruleId) return null;
  const r = await prisma.crosswalkRule.findUnique({
    where: { id: ruleId },
    select: { name: true, priority: true },
  });
  return r ? supersetMessage(r.name ?? ruleId, r.priority) : null;
}

export async function supersetWarning(
  orgId: string,
  candidate: SupersetCandidate,
  range: DateRange,
): Promise<string | null> {
  if (!hasConditions(candidate.matchers)) return null;
  const { lines: all } = await loadEngineLines(orgId);
  const lines = all.filter((l) => l.txnDate >= range.from && l.txnDate <= range.to);

  if ('kind' in candidate) {
    const config = await loadEngineConfig(orgId);
    const others = config.crosswalkRules.filter((r) => r.id !== candidate.ruleId);
    if (!candidate.grantBudgetLineId) {
      config.budgetLines.push({ id: '', grantId: PREVIEW_RULE_ID, programId: null });
      config.grants.push({
        id: PREVIEW_RULE_ID,
        startDate: new Date(0),
        endDate: new Date('2999-12-31'),
        status: 'active',
      });
    }
    const run = (priority: number) => {
      const rule: EngineCrosswalkRule = {
        id: PREVIEW_RULE_ID,
        matchers: candidate.matchers,
        grantBudgetLineId: candidate.grantBudgetLineId ?? '',
        priority,
        active: true,
      };
      return allocate(lines, { ...config, crosswalkRules: [...others, rule] }).pieces;
    };
    const key = (p: { sourceLineId: string; programId: string | null }) =>
      `${p.sourceLineId}|${p.programId ?? ''}`;
    const asIs = run(candidate.priority);
    if (asIs.some((p) => p.crosswalkRuleId === PREVIEW_RULE_ID)) return null;
    const first = run(-1).filter((p) => p.crosswalkRuleId === PREVIEW_RULE_ID);
    if (first.length === 0) return null;
    const winnerByPiece = new Map(asIs.map((p) => [key(p), p.crosswalkRuleId]));
    return message(topRule(first.map((p) => winnerByPiece.get(key(p)) ?? null)));
  }

  const config = await loadGrantStageConfig(orgId, lines);
  const others = config.rules.filter((r) => r.id !== candidate.ruleId);
  const run = (priority: number) => {
    const rule: GrantStageRule = {
      id: PREVIEW_RULE_ID,
      grantId: candidate.grantId,
      dimension: candidate.dimension,
      matchers: candidate.matchers,
      priority,
      active: true,
      targetBudgetLineId: candidate.grantBudgetLineId ?? PREVIEW_RULE_ID,
      targetActivityId: candidate.targetActivityId ?? PREVIEW_RULE_ID,
      targetCategoryKey: candidate.targetCategoryKey ?? PREVIEW_RULE_ID,
    };
    const cfg = { ...config, rules: [...others, rule], budgetLines: [...config.budgetLines] };
    if (candidate.dimension === 'line' && !candidate.grantBudgetLineId)
      cfg.budgetLines.push({
        id: PREVIEW_RULE_ID,
        grantId: candidate.grantId,
        kind: 'working_line',
        activityId: null,
        categoryKey: null,
      });
    return assignGrantLines(lines, cfg).filter((d) => d.grantId === candidate.grantId);
  };
  const decidedBy = (d: { ruleId: string | null; categoryRuleId: string | null }) =>
    candidate.dimension === 'category' ? d.categoryRuleId : d.ruleId;
  const asIs = run(candidate.priority);
  if (asIs.some((d) => decidedBy(d) === PREVIEW_RULE_ID)) return null;
  const first = run(-1).filter((d) => decidedBy(d) === PREVIEW_RULE_ID);
  if (first.length === 0) return null;
  const winnerByLine = new Map(asIs.map((d) => [d.transactionLineId, decidedBy(d)]));
  return message(topRule(first.map((d) => winnerByLine.get(d.transactionLineId) ?? null)));
}
