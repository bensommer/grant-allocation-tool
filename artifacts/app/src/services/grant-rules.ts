/**
 * Grant-scoped rules (JPH-21). Stored as CrosswalkRule rows with `grantId` set
 * so they share matchers, audit and labels with program crosswalk rules, but
 * they only ever see the grant's member lines and run in the grant stage.
 *
 * dimension = line     → target is a working line or cell of the grant
 * dimension = activity → target is one of the grant's activities
 * dimension = category → target is a category key
 */
import { z } from 'zod';
import type { Prisma } from '@/generated/prisma/client';
import { prisma } from '@/lib/db';
import { recordAudit } from '@/lib/audit';
import { markCurrentRunStale } from '@/lib/stale';
import { categoryKeyPattern } from '@/domain/categories';
import { isEmptyMatchers, lineMatches, matchersSchema, type Matchers } from '@/domain/matchers';
import { assignGrantLines, type GrantLineDraft, type GrantStageRule } from '@/engine/core';
import { loadEngineLines, loadGrantStageConfig } from '@/engine/recompute';
import { zodErrors } from '@/lib/zod-errors';
import { assertMatcherRefs } from './refs';
import { inTransaction, type Db } from './grants';
import { ValidationError } from './programs';

export const grantRuleInputSchema = z.object({
  name: z.string().trim().min(1, 'Name is required').max(200),
  dimension: z.enum(['line', 'activity', 'category']),
  grantBudgetLineId: z.string().nullable(),
  targetActivityId: z.string().nullable(),
  targetCategoryKey: z
    .string()
    .regex(categoryKeyPattern, 'Category key: lower-case letters, digits, underscore')
    .nullable(),
  priority: z.number().int('Priority must be an integer').min(0, 'Priority cannot be negative'),
  active: z.boolean(),
  matchers: matchersSchema
    .refine((m) => !isEmptyMatchers(m), 'Add at least one condition')
    .refine(
      (m) => !m.accountRange || (!!m.accountRange.from && !!m.accountRange.to),
      'Enter both account range endpoints',
    ),
});
export type GrantRuleInput = z.infer<typeof grantRuleInputSchema>;

async function validate(orgId: string, grantId: string, input: GrantRuleInput, db: Db = prisma) {
  const result = grantRuleInputSchema.safeParse(input);
  if (!result.success) throw new ValidationError(zodErrors(result.error));
  const d = result.data;
  const grant = await db.grant.findFirst({ where: { id: grantId, orgId } });
  if (!grant) throw new ValidationError({ _: 'Grant not found' });
  const data = {
    name: d.name,
    dimension: d.dimension,
    grantBudgetLineId: null as string | null,
    targetActivityId: null as string | null,
    targetCategoryKey: null as string | null,
    priority: d.priority,
    active: d.active,
  };
  if (d.dimension === 'line') {
    if (!d.grantBudgetLineId)
      throw new ValidationError({ grantBudgetLineId: 'Select a target line' });
    const line = await db.grantBudgetLine.findFirst({
      where: { id: d.grantBudgetLineId, orgId, grantId },
    });
    if (!line) throw new ValidationError({ grantBudgetLineId: 'Budget line not found' });
    if (line.kind === 'funder_category')
      throw new ValidationError({ grantBudgetLineId: 'Target a working line or cell' });
    data.grantBudgetLineId = line.id;
  } else if (d.dimension === 'activity') {
    if (!d.targetActivityId) throw new ValidationError({ targetActivityId: 'Select an activity' });
    const a = await db.grantActivity.findFirst({
      where: { id: d.targetActivityId, orgId, grantId },
    });
    if (!a) throw new ValidationError({ targetActivityId: 'Activity not found' });
    data.targetActivityId = a.id;
  } else {
    if (!d.targetCategoryKey) throw new ValidationError({ targetCategoryKey: 'Select a category' });
    data.targetCategoryKey = d.targetCategoryKey;
  }
  await assertMatcherRefs(db, orgId, d.matchers);
  return { ...data, matchers: d.matchers as Prisma.InputJsonValue };
}

export async function createGrantRule(
  orgId: string,
  grantId: string,
  input: GrantRuleInput,
  db: Db = prisma,
) {
  const data = await validate(orgId, grantId, input, db);
  return inTransaction(db, async (tx) => {
    const after = await tx.crosswalkRule.create({ data: { orgId, grantId, ...data } });
    await recordAudit(tx, {
      orgId,
      entity: 'CrosswalkRule',
      entityId: after.id,
      action: 'create',
      after,
    });
    await markCurrentRunStale(tx, orgId);
    return after;
  });
}

export async function updateGrantRule(
  orgId: string,
  grantId: string,
  id: string,
  input: GrantRuleInput,
) {
  const data = await validate(orgId, grantId, input);
  return prisma.$transaction(async (tx) => {
    const before = await tx.crosswalkRule.findFirst({ where: { id, orgId, grantId } });
    if (!before) throw new ValidationError({ _: 'Rule not found' });
    const after = await tx.crosswalkRule.update({ where: { id }, data });
    await recordAudit(tx, {
      orgId,
      entity: 'CrosswalkRule',
      entityId: id,
      action: 'update',
      before,
      after,
    });
    await markCurrentRunStale(tx, orgId);
    return after;
  });
}

/** Grant rules are never hard-deleted: past runs reference them. */
export async function deactivateGrantRule(orgId: string, grantId: string, id: string) {
  return prisma.$transaction(async (tx) => {
    const before = await tx.crosswalkRule.findFirst({ where: { id, orgId, grantId } });
    if (!before) throw new ValidationError({ _: 'Rule not found' });
    const after = await tx.crosswalkRule.update({ where: { id }, data: { active: false } });
    await recordAudit(tx, {
      orgId,
      entity: 'CrosswalkRule',
      entityId: id,
      action: 'update',
      before,
      after,
    });
    await markCurrentRunStale(tx, orgId);
    return after;
  });
}

export const GRANT_RULE_PREVIEW_ID = '__grant_rule_preview__';

export interface GrantRulePreview {
  /** Member lines the candidate would decide (line rules) or resolve (activity/category rules). */
  count: number;
  totalCents: number;
  lineIds: string[];
  /** Lines the candidate matches but that a decision or an earlier rule already settles. */
  shadowed: number;
}

/**
 * Runs the real grant stage with the candidate inserted (or replacing the rule
 * being edited) and reports what it would win, so priority and decisions are
 * honoured exactly as in a recompute.
 */
export async function previewGrantRule(
  orgId: string,
  grantId: string,
  candidate: {
    dimension: 'line' | 'activity' | 'category';
    matchers: Matchers;
    priority: number;
    grantBudgetLineId: string | null;
    targetActivityId: string | null;
    targetCategoryKey: string | null;
    ruleId?: string;
  },
): Promise<GrantRulePreview> {
  const { lines } = await loadEngineLines(orgId);
  const config = await loadGrantStageConfig(orgId, lines);
  const rule: GrantStageRule = {
    id: GRANT_RULE_PREVIEW_ID,
    grantId,
    dimension: candidate.dimension,
    matchers: candidate.matchers,
    priority: candidate.priority,
    active: true,
    targetBudgetLineId: candidate.grantBudgetLineId,
    targetActivityId: candidate.targetActivityId,
    targetCategoryKey: candidate.targetCategoryKey,
  };
  // A candidate without a target yet should still show what it matches.
  if (candidate.dimension === 'line' && !rule.targetBudgetLineId) {
    rule.targetBudgetLineId = GRANT_RULE_PREVIEW_ID;
    config.budgetLines.push({
      id: GRANT_RULE_PREVIEW_ID,
      grantId,
      kind: 'working_line',
      activityId: null,
      categoryKey: null,
    });
  }
  if (candidate.dimension === 'activity' && !rule.targetActivityId)
    rule.targetActivityId = GRANT_RULE_PREVIEW_ID;
  if (candidate.dimension === 'category' && !rule.targetCategoryKey)
    rule.targetCategoryKey = GRANT_RULE_PREVIEW_ID;
  config.rules = [...config.rules.filter((r) => r.id !== candidate.ruleId), rule];
  const drafts = assignGrantLines(lines, config).filter((d) => d.grantId === grantId);
  const won = drafts.filter(
    (d) => d.ruleId === GRANT_RULE_PREVIEW_ID || d.categoryRuleId === GRANT_RULE_PREVIEW_ID,
  );
  // Count raw matches among the grant's members to report what earlier rules/decisions absorb.
  const wonIds = new Set(won.map((d) => d.transactionLineId));
  const memberIds = new Set(drafts.map((d) => d.transactionLineId));
  let shadowed = 0;
  for (const l of lines) {
    if (!memberIds.has(l.id) || wonIds.has(l.id)) continue;
    const m = {
      accountId: l.accountId,
      accountNumber: l.accountNumber,
      classId: l.classId,
      locationId: l.locationId,
      partyId: l.partyId,
      txnPartyId: l.txnPartyId,
      description: l.description,
      memo: l.memo,
      txnDate: l.txnDate,
      programId: null,
      txnType: l.txnType ?? null,
      amountCents: l.amountCents,
    };
    if (lineMatches(m, candidate.matchers)) shadowed++;
  }
  return {
    count: won.length,
    totalCents: won.reduce((a, d) => a + d.amountCents, 0),
    lineIds: won.flatMap((d) => (d.transactionLineId ? [d.transactionLineId] : [])),
    shadowed,
  };
}

export type { GrantLineDraft };
