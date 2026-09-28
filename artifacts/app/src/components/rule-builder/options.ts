/**
 * Everything the rule builder can pick from (JPH-26 B2), loaded on the server and passed to the
 * builder as plain JSON. The same lists feed describeRule's labels, so the sentence the server
 * renders and the sentence the island renders come from one source.
 */
import { CATEGORY_KEYS, categoryLabel } from '@/domain/categories';
import type { BuilderOptions } from './types';
import { prisma } from '@/lib/db';
import { budgetTree } from '@/services/grant-budget';

const EXPENSE_TYPES = new Set(['Expense', 'COGS', 'OtherExpense']);

async function sharedOptions(orgId: string) {
  const [programs, accounts, classes, locations, parties, txnTypes] = await Promise.all([
    prisma.program.findMany({ where: { orgId }, orderBy: { code: 'asc' } }),
    prisma.account.findMany({
      where: { orgId, deletedAt: null },
      orderBy: [{ number: 'asc' }, { name: 'asc' }],
    }),
    prisma.trackingClass.findMany({ where: { orgId, deletedAt: null }, orderBy: { name: 'asc' } }),
    prisma.trackingLocation.findMany({
      where: { orgId, deletedAt: null },
      orderBy: { name: 'asc' },
    }),
    prisma.party.findMany({ where: { orgId, deletedAt: null }, orderBy: { displayName: 'asc' } }),
    prisma.transaction.findMany({
      where: { orgId },
      distinct: ['txnType'],
      select: { txnType: true },
      orderBy: { txnType: 'asc' },
    }),
  ]);
  return {
    programs: programs.map((p) => ({ id: p.id, label: `${p.name} (${p.code})`, name: p.name })),
    accounts: accounts.map((a) => ({
      id: a.id,
      label: `${a.name} ${a.number ?? ''}`.trim(),
      name: a.name,
      expense: EXPENSE_TYPES.has(a.type),
    })),
    classes: classes.map((c) => ({ id: c.id, label: c.name })),
    locations: locations.map((l) => ({ id: l.id, label: l.name })),
    parties: parties.map((p) => ({ id: p.id, label: p.displayName })),
    txnTypes: txnTypes.map((t) => String(t.txnType)),
  };
}

export async function crosswalkBuilderOptions(orgId: string): Promise<BuilderOptions> {
  const [shared, grants] = await Promise.all([
    sharedOptions(orgId),
    prisma.grant.findMany({
      where: { orgId },
      include: { budgetLines: { orderBy: { sortOrder: 'asc' } } },
      orderBy: { name: 'asc' },
    }),
  ]);
  return {
    ...shared,
    grants: grants.map((g) => ({
      id: g.id,
      name: g.name,
      lines: g.budgetLines.map((l) => ({ id: l.id, label: `${l.code} — ${l.name}` })),
    })),
  };
}

export async function grantBuilderOptions(orgId: string, grantId: string): Promise<BuilderOptions> {
  const [shared, tree] = await Promise.all([sharedOptions(orgId), budgetTree(orgId, grantId)]);
  const activityName = new Map(tree.activities.map((a) => [a.id, a.name]));
  return {
    ...shared,
    // Grant rules never see a program: member lines carry none.
    programs: [],
    lines: tree.all
      .filter((l) => l.kind !== 'funder_category')
      .map((l) => ({
        id: l.id,
        label:
          l.kind === 'cell'
            ? `${l.code} — ${activityName.get(l.activityId ?? '') ?? '?'} / ${l.categoryKey}`
            : `${l.code} — ${l.name}`,
      })),
    activities: tree.activities.map((a) => ({ id: a.id, label: a.name })),
    categories: [...new Set([...CATEGORY_KEYS, ...tree.categoryKeys])].map((k) => ({
      id: k,
      label: categoryLabel(k),
    })),
  };
}
