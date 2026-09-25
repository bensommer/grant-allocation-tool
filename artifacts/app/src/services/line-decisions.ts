/**
 * Line decisions (JPH-21): assign / exclude / at-risk / reversal-pair
 * judgements about a grant's member lines. Keyed by the line's import
 * fingerprint (`lineFingerprint`: Transaction.externalId plus the line number,
 * so multi-line transactions keep one decision per line) so they survive
 * re-import. One row per line; the lines of one judgement share a groupId. Rows are superseded,
 * never deleted, so the review trail stays complete.
 */
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { prisma } from '@/lib/db';
import { recordAudit } from '@/lib/audit';
import { markCurrentRunStale } from '@/lib/stale';
import { ValidationError } from './programs';

/** Stable identity of a line across re-imports of the same source. */
export const lineFingerprint = (l: {
  lineNumber: number;
  transaction: { externalId: string };
}): string => `${l.transaction.externalId}#${l.lineNumber}`;
const FINGERPRINT_SELECT = {
  lineNumber: true,
  transaction: { select: { externalId: true } },
} as const;

export const decisionInputSchema = z.object({
  kind: z.enum(['assign', 'exclude', 'at_risk', 'reversal_pair']),
  lineIds: z.array(z.string().min(1)).min(1, 'Select at least one line'),
  targetBudgetLineId: z.string().nullable(),
  reason: z.string().trim().max(200).nullable(),
  note: z.string().trim().min(1, 'A note is required').max(1000),
});
export type DecisionInput = z.infer<typeof decisionInputSchema>;

export const REVERSAL_PAIR_REASON = 'reversal pair';

/**
 * Records one decision over a set of member lines. A new assign / exclude /
 * reversal_pair decision supersedes the previous state decision of each line;
 * at_risk is an independent flag that supersedes only earlier at_risk rows.
 */
export async function recordDecision(
  orgId: string,
  grantId: string,
  input: DecisionInput,
  actor = 'local-user',
) {
  const parsed = decisionInputSchema.safeParse(input);
  if (!parsed.success) throw new ValidationError({ _: parsed.error.issues[0]!.message });
  const d = parsed.data;
  const grant = await prisma.grant.findFirst({ where: { id: grantId, orgId } });
  if (!grant) throw new ValidationError({ _: 'Grant not found' });
  if (d.kind === 'assign') {
    if (!d.targetBudgetLineId) throw new ValidationError({ targetBudgetLineId: 'Select a target' });
    const target = await prisma.grantBudgetLine.findFirst({
      where: { id: d.targetBudgetLineId, orgId, grantId },
    });
    if (!target) throw new ValidationError({ targetBudgetLineId: 'Budget line not found' });
    if (target.kind === 'funder_category')
      throw new ValidationError({ targetBudgetLineId: 'Assign to a working line or cell' });
  }
  if (d.kind === 'reversal_pair' && d.lineIds.length !== 2)
    throw new ValidationError({ _: 'A reversal pair is exactly two lines' });
  const lineIds = [...new Set(d.lineIds)];
  const lines = await prisma.transactionLine.findMany({
    where: {
      id: { in: lineIds },
      orgId,
      memberships: { some: { grantId, supersededAt: null } },
    },
    select: { id: true, amountCents: true, accountId: true, ...FINGERPRINT_SELECT },
  });
  if (lines.length !== lineIds.length)
    throw new ValidationError({ _: 'Every line must be a current member of this grant' });
  if (d.kind === 'reversal_pair') {
    if (lines[0]!.amountCents + lines[1]!.amountCents !== 0)
      throw new ValidationError({ _: 'A reversal pair must net to zero' });
    if (lines[0]!.accountId !== lines[1]!.accountId)
      throw new ValidationError({ _: 'A reversal pair must post to the same account' });
  }

  const groupId = randomUUID();
  const fingerprints = lines.map(lineFingerprint);
  const now = new Date();
  return prisma.$transaction(async (tx) => {
    const supersede = await tx.lineDecision.updateMany({
      where: {
        orgId,
        grantId,
        supersededAt: null,
        fingerprint: { in: fingerprints },
        kind: d.kind === 'at_risk' ? 'at_risk' : { not: 'at_risk' },
      },
      data: { supersededAt: now },
    });
    const created = [];
    for (const l of lines) {
      const row = await tx.lineDecision.create({
        data: {
          orgId,
          grantId,
          groupId,
          fingerprint: lineFingerprint(l),
          transactionLineId: l.id,
          kind: d.kind,
          targetBudgetLineId: d.kind === 'assign' ? d.targetBudgetLineId : null,
          reason: d.kind === 'reversal_pair' ? (d.reason ?? REVERSAL_PAIR_REASON) : d.reason,
          note: d.note,
          actor,
        },
      });
      created.push(row);
    }
    await recordAudit(tx, {
      orgId,
      entity: 'LineDecision',
      entityId: groupId,
      action: 'create',
      after: { kind: d.kind, lines: created.length, superseded: supersede.count, note: d.note },
      actor,
    });
    await markCurrentRunStale(tx, orgId);
    return { groupId, rows: created };
  });
}

/** Clears the active at-risk flag on the given lines (supersedes the rows). */
export async function clearAtRisk(
  orgId: string,
  grantId: string,
  lineIds: string[],
  actor = 'local-user',
) {
  const lines = await prisma.transactionLine.findMany({
    where: { id: { in: lineIds }, orgId },
    select: FINGERPRINT_SELECT,
  });
  const fingerprints = lines.map(lineFingerprint);
  return prisma.$transaction(async (tx) => {
    const r = await tx.lineDecision.updateMany({
      where: {
        orgId,
        grantId,
        kind: 'at_risk',
        supersededAt: null,
        fingerprint: { in: fingerprints },
      },
      data: { supersededAt: new Date() },
    });
    if (r.count > 0) {
      await recordAudit(tx, {
        orgId,
        entity: 'LineDecision',
        entityId: grantId,
        action: 'update',
        after: { clearedAtRisk: r.count },
        actor,
      });
      await markCurrentRunStale(tx, orgId);
    }
    return r.count;
  });
}

/** Supersedes the active state decision(s) of the given lines so rules apply again. */
export async function revertDecision(
  orgId: string,
  grantId: string,
  lineIds: string[],
  actor = 'local-user',
) {
  const lines = await prisma.transactionLine.findMany({
    where: { id: { in: lineIds }, orgId },
    select: FINGERPRINT_SELECT,
  });
  const fingerprints = lines.map(lineFingerprint);
  return prisma.$transaction(async (tx) => {
    const r = await tx.lineDecision.updateMany({
      where: {
        orgId,
        grantId,
        kind: { not: 'at_risk' },
        supersededAt: null,
        fingerprint: { in: fingerprints },
      },
      data: { supersededAt: new Date() },
    });
    if (r.count > 0) {
      await recordAudit(tx, {
        orgId,
        entity: 'LineDecision',
        entityId: grantId,
        action: 'update',
        after: { reverted: r.count },
        actor,
      });
      await markCurrentRunStale(tx, orgId);
    }
    return r.count;
  });
}
