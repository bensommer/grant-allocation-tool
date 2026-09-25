import { prisma } from '@/lib/db';
import { pick, pickList, type FormState } from '@/lib/forms';
import { CATEGORY_KEYS } from '@/domain/categories';
import { parseMatchers, type Matchers } from '@/domain/matchers';
import { budgetTree } from '@/services/grant-budget';
import { previewGrantRule } from '@/services/grant-rules';
import type { PreviewSample, RuleFormOptions } from './rule-form';

export async function grantRuleOptions(orgId: string, grantId: string): Promise<RuleFormOptions> {
  const [tree, accounts, classes, parties, txnTypes] = await Promise.all([
    budgetTree(orgId, grantId),
    prisma.account.findMany({
      where: { orgId, deletedAt: null },
      orderBy: [{ number: 'asc' }, { name: 'asc' }],
    }),
    prisma.trackingClass.findMany({ where: { orgId, deletedAt: null }, orderBy: { name: 'asc' } }),
    prisma.party.findMany({ where: { orgId, deletedAt: null }, orderBy: { displayName: 'asc' } }),
    prisma.transaction.findMany({
      where: { orgId },
      distinct: ['txnType'],
      select: { txnType: true },
      orderBy: { txnType: 'asc' },
    }),
  ]);
  const activityName = new Map(tree.activities.map((a) => [a.id, a.name]));
  return {
    targets: tree.all
      .filter((l) => l.kind !== 'funder_category')
      .map((l) => ({
        id: l.id,
        label:
          l.kind === 'cell'
            ? `${l.code} — ${activityName.get(l.activityId ?? '') ?? '?'} / ${l.categoryKey}`
            : `${l.code} — ${l.name}`,
      })),
    activities: tree.activities.map((a) => ({ id: a.id, name: a.name })),
    categoryKeys: [...new Set([...CATEGORY_KEYS, ...tree.categoryKeys])],
    accounts: accounts.map((a) => ({
      id: a.id,
      label: `${a.number ? `${a.number} ` : ''}${a.name}`,
    })),
    classes: classes.map((c) => ({ id: c.id, label: c.name })),
    parties: parties.map((p) => ({ id: p.id, label: p.displayName })),
    txnTypes: txnTypes.map((t) => t.txnType),
  };
}

/** Rebuilds matchers from a bounced form state (the ?preview=1 round trip). */
export function previewMatchers(state: FormState): Matchers {
  const dateFrom = pick(state, 'dateFrom', '');
  const dateTo = pick(state, 'dateTo', '');
  const sign = pick(state, 'amountSign', '');
  return parseMatchers({
    accountIds: pickList(state, 'accountIds', []),
    classIds: pickList(state, 'classIds', []),
    partyIds: pickList(state, 'partyIds', []),
    descriptionContains: pick(state, 'descriptionContains', ''),
    descriptionContainsAny: pick(state, 'descriptionContainsAny', '')
      .split(/[,;\n]/)
      .map((a) => a.trim())
      .filter((a) => a !== ''),
    txnTypes: pickList(state, 'txnTypes', []),
    ...(sign ? { amountSign: sign } : {}),
    ...(dateFrom ? { dateFrom } : {}),
    ...(dateTo ? { dateTo } : {}),
  });
}

export async function runPreview(
  orgId: string,
  grantId: string,
  state: FormState,
  ruleId?: string,
): Promise<{ result: Awaited<ReturnType<typeof previewGrantRule>>; sample: PreviewSample[] }> {
  const dimension = (pick(state, 'dimension', 'line') || 'line') as
    'line' | 'activity' | 'category';
  const result = await previewGrantRule(orgId, grantId, {
    dimension,
    matchers: previewMatchers(state),
    priority: Number(pick(state, 'priority', '100')) || 0,
    grantBudgetLineId: dimension === 'line' ? pick(state, 'grantBudgetLineId', '') || null : null,
    targetActivityId: dimension === 'activity' ? pick(state, 'targetActivityId', '') || null : null,
    targetCategoryKey:
      dimension === 'category' ? pick(state, 'targetCategoryKey', '') || null : null,
    ...(ruleId ? { ruleId } : {}),
  });
  const lines = await prisma.transactionLine.findMany({
    where: { id: { in: result.lineIds.slice(0, 100) } },
    include: {
      account: { select: { name: true, number: true } },
      party: { select: { displayName: true } },
      transaction: {
        select: {
          txnDate: true,
          docNumber: true,
          memo: true,
          party: { select: { displayName: true } },
        },
      },
    },
    orderBy: [{ transaction: { txnDate: 'asc' } }, { id: 'asc' }],
  });
  return {
    result,
    sample: lines.map((l) => ({
      id: l.id,
      txnDate: l.transaction.txnDate,
      docNumber: l.transaction.docNumber,
      account: l.account.number ? `${l.account.number} ${l.account.name}` : l.account.name,
      party: l.party?.displayName ?? l.transaction.party?.displayName ?? null,
      description: l.description ?? l.transaction.memo,
      amountCents: l.amountCents,
    })),
  };
}
