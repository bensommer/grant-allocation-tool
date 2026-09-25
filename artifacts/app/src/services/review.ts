/**
 * Review queue (JPH-21): the current run's grant-stage results for one grant,
 * grouped by why they need attention, plus reversal-pair proposals and the
 * decision trail. Read-only; decisions go through ./line-decisions.
 */
import { prisma } from '@/lib/db';
import { proposeReversalPairs, type GrantLineDraft } from '@/engine/grant-stage';

export interface ReviewLine {
  id: string;
  txnDate: Date;
  txnType: string;
  docNumber: string | null;
  party: string | null;
  account: string;
  className: string | null;
  description: string | null;
  amountCents: number;
  state: 'assigned' | 'excluded' | 'needs_review';
  budgetLineId: string | null;
  budgetLineCode: string | null;
  activityName: string | null;
  ruleName: string | null;
  decisionId: string | null;
  reason: string | null;
  atRisk: boolean;
}

export interface ReviewGroup {
  reason: string;
  lines: ReviewLine[];
  totalCents: number;
}

export interface ReviewQueue {
  runId: string | null;
  stale: boolean;
  counts: { assigned: number; excluded: number; needsReview: number; atRisk: number };
  totals: { assignedCents: number; excludedCents: number; needsReviewCents: number; memberCents: number };
  groups: ReviewGroup[];
  assigned: ReviewLine[];
  excluded: ReviewLine[];
  proposals: Array<{ positive: ReviewLine; negative: ReviewLine; amountCents: number }>;
  decisions: Array<{
    id: string;
    groupId: string;
    kind: string;
    fingerprint: string;
    lineId: string | null;
    targetCode: string | null;
    reason: string | null;
    note: string;
    actor: string;
    createdAt: Date;
    supersededAt: Date | null;
  }>;
}

export async function reviewQueue(orgId: string, grantId: string): Promise<ReviewQueue> {
  const run = await prisma.computeRun.findFirst({
    where: { orgId, isCurrent: true },
    select: { id: true, stale: true },
  });
  const [results, decisions] = await Promise.all([
    run
      ? prisma.grantLineResult.findMany({
          where: { computeRunId: run.id, grantId },
          include: {
            line: {
              include: {
                account: { select: { name: true, number: true } },
                class: { select: { name: true } },
                party: { select: { displayName: true } },
                transaction: {
                  select: {
                    txnDate: true,
                    txnType: true,
                    docNumber: true,
                    partyId: true,
                    memo: true,
                    party: { select: { displayName: true } },
                  },
                },
              },
            },
            budgetLine: { select: { code: true } },
            activity: { select: { name: true } },
          },
        })
      : Promise.resolve([]),
    prisma.lineDecision.findMany({
      where: { orgId, grantId },
      orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
      include: { targetBudgetLine: { select: { code: true } } },
    }),
  ]);
  const ruleIds = [
    ...new Set(results.flatMap((r) => [r.ruleId, r.categoryRuleId]).filter((x): x is string => !!x)),
  ];
  const rules = ruleIds.length
    ? await prisma.crosswalkRule.findMany({
        where: { id: { in: ruleIds } },
        select: { id: true, name: true },
      })
    : [];
  const ruleName = new Map(rules.map((r) => [r.id, r.name ?? r.id]));

  const lines: ReviewLine[] = results
    .map((r) => ({
      id: r.transactionLineId,
      txnDate: r.line.transaction.txnDate,
      txnType: r.line.transaction.txnType,
      docNumber: r.line.transaction.docNumber,
      party: r.line.party?.displayName ?? r.line.transaction.party?.displayName ?? null,
      account: r.line.account.number
        ? `${r.line.account.number} ${r.line.account.name}`
        : r.line.account.name,
      className: r.line.class?.name ?? null,
      description: r.line.description ?? r.line.transaction.memo,
      amountCents: r.amountCents,
      state: r.state,
      budgetLineId: r.budgetLineId,
      budgetLineCode: r.budgetLine?.code ?? null,
      activityName: r.activity?.name ?? null,
      ruleName:
        [r.ruleId, r.categoryRuleId]
          .filter((x): x is string => !!x)
          .map((id) => ruleName.get(id) ?? id)
          .join(' + ') || null,
      decisionId: r.decisionId,
      reason: r.reason,
      atRisk: r.atRisk,
    }))
    .sort(
      (a, b) =>
        a.txnDate.getTime() - b.txnDate.getTime() ||
        (a.docNumber ?? '').localeCompare(b.docNumber ?? '') ||
        a.id.localeCompare(b.id),
    );
  const byId = new Map(lines.map((l) => [l.id, l]));

  const needsReview = lines.filter((l) => l.state === 'needs_review');
  const groupMap = new Map<string, ReviewLine[]>();
  for (const l of needsReview) {
    const key = l.reason ?? 'needs review';
    groupMap.set(key, [...(groupMap.get(key) ?? []), l]);
  }
  const groups: ReviewGroup[] = [...groupMap.entries()]
    .map(([reason, ls]) => ({
      reason,
      lines: ls,
      totalCents: ls.reduce((a, l) => a + l.amountCents, 0),
    }))
    .sort((a, b) => a.reason.localeCompare(b.reason));

  const drafts: GrantLineDraft[] = results.map((r) => ({
    grantId: r.grantId,
    transactionLineId: r.transactionLineId,
    state: r.state,
    budgetLineId: r.budgetLineId,
    activityId: r.activityId,
    ruleId: r.ruleId,
    categoryRuleId: r.categoryRuleId,
    decisionId: r.decisionId,
    reason: r.reason,
    atRisk: r.atRisk,
    amountCents: r.amountCents,
  }));
  const infoOf = new Map(
    results.map((r) => [
      r.transactionLineId,
      {
        accountId: r.line.accountId,
        docNumber: r.line.transaction.docNumber,
        description: r.line.description,
        partyId: r.line.transaction.partyId,
        txnDate: r.line.transaction.txnDate,
      },
    ]),
  );
  const proposals = proposeReversalPairs(drafts, (id) => infoOf.get(id) ?? null).map((p) => ({
    positive: byId.get(p.positiveLineId)!,
    negative: byId.get(p.negativeLineId)!,
    amountCents: p.amountCents,
  }));

  const sum = (ls: ReviewLine[]) => ls.reduce((a, l) => a + l.amountCents, 0);
  const assigned = lines.filter((l) => l.state === 'assigned');
  const excluded = lines.filter((l) => l.state === 'excluded');
  return {
    runId: run?.id ?? null,
    stale: run?.stale ?? false,
    counts: {
      assigned: assigned.length,
      excluded: excluded.length,
      needsReview: needsReview.length,
      atRisk: lines.filter((l) => l.atRisk).length,
    },
    totals: {
      assignedCents: sum(assigned),
      excludedCents: sum(excluded),
      needsReviewCents: sum(needsReview),
      memberCents: sum(lines),
    },
    groups,
    assigned,
    excluded,
    proposals,
    decisions: decisions.map((d) => ({
      id: d.id,
      groupId: d.groupId,
      kind: d.kind,
      fingerprint: d.fingerprint,
      lineId: d.transactionLineId,
      targetCode: d.targetBudgetLine?.code ?? null,
      reason: d.reason,
      note: d.note,
      actor: d.actor,
      createdAt: d.createdAt,
      supersededAt: d.supersededAt,
    })),
  };
}
