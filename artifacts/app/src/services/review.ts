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
  /** A decision recorded after the current run settled this line; recompute makes it official. */
  pending: boolean;
  // What the suggestion engine and the "Always do this" link need (JPH-27).
  accountId: string;
  accountName: string;
  accountNumber: string | null;
  classId: string | null;
  locationId: string | null;
  partyId: string | null;
  partyName: string | null;
  txnPartyId: string | null;
  txnPartyName: string | null;
  memo: string | null;
  activityId: string | null;
  ruleId: string | null;
  categoryRuleId: string | null;
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
          // Effort charges (source = effort) have no transaction line and are not reviewed here.
          where: { computeRunId: run.id, grantId, source: 'transaction' },
          include: {
            line: {
              include: {
                account: { select: { name: true, number: true } },
                class: { select: { name: true } },
                party: { select: { id: true, displayName: true } },
                transaction: {
                  select: {
                    txnDate: true,
                    txnType: true,
                    docNumber: true,
                    partyId: true,
                    memo: true,
                    party: { select: { id: true, displayName: true } },
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

  // Decisions recorded since the current run: the queue shows them settled straight away
  // (the row disappears on the round trip); the run itself catches up on recompute.
  const active = decisions.filter((d) => d.supersededAt === null && d.transactionLineId);
  const stateDecision = new Map(
    active.filter((d) => d.kind !== 'at_risk').map((d) => [d.transactionLineId!, d]),
  );
  const atRiskDecision = new Set(
    active.filter((d) => d.kind === 'at_risk').map((d) => d.transactionLineId!),
  );
  const targetCode = new Map(
    decisions.flatMap((d) =>
      d.targetBudgetLineId ? [[d.targetBudgetLineId, d.targetBudgetLine?.code ?? null]] : [],
    ),
  );

  // The `source: transaction` filter above guarantees a line; narrow the type once.
  const rows = results.flatMap((r) => {
    if (!r.line || !r.transactionLineId) return [];
    const d = stateDecision.get(r.transactionLineId);
    // Already in the run (same decision) or nothing newer: the run is the truth.
    if (!d || r.decisionId === d.id) return [{ ...r, line: r.line, transactionLineId: r.transactionLineId, pending: false }];
    return [
      {
        ...r,
        line: r.line,
        transactionLineId: r.transactionLineId,
        pending: true,
        state: d.kind === 'assign' ? ('assigned' as const) : ('excluded' as const),
        budgetLineId: d.kind === 'assign' ? d.targetBudgetLineId : null,
        budgetLine: d.kind === 'assign' && d.targetBudgetLineId ? { code: targetCode.get(d.targetBudgetLineId) ?? '' } : null,
        activityId: null,
        activity: null,
        ruleId: null,
        categoryRuleId: null,
        decisionId: d.id,
        reason: d.kind === 'assign' ? null : d.reason,
      },
    ];
  });
  const lines: ReviewLine[] = rows
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
      atRisk: r.atRisk || atRiskDecision.has(r.transactionLineId),
      pending: r.pending,
      accountId: r.line.accountId,
      accountName: r.line.account.name,
      accountNumber: r.line.account.number,
      classId: r.line.classId,
      locationId: r.line.locationId,
      partyId: r.line.party?.id ?? null,
      partyName: r.line.party?.displayName ?? null,
      txnPartyId: r.line.transaction.partyId,
      txnPartyName: r.line.transaction.party?.displayName ?? null,
      memo: r.line.transaction.memo,
      activityId: r.activityId,
      ruleId: r.ruleId,
      categoryRuleId: r.categoryRuleId,
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

  const drafts: GrantLineDraft[] = rows.map((r) => ({
    grantId: r.grantId,
    source: 'transaction',
    transactionLineId: r.transactionLineId,
    effortEntryId: null,
    effortScheduleId: null,
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
    rows.map((r) => [
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
