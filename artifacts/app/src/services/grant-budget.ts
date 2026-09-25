/**
 * Two-level grant budgets (JPH-21): funder categories → working lines / cells,
 * revisions with notes, and the spent-to-date figures from the current run.
 */
import { z } from 'zod';
import { prisma } from '@/lib/db';
import { recordAudit } from '@/lib/audit';
import { markCurrentRunStale } from '@/lib/stale';
import { MAX_CENTS } from '@/domain/money';
import { ValidationError } from '@/services/programs';

export interface BudgetLineView {
  id: string;
  code: string;
  name: string;
  kind: 'funder_category' | 'working_line' | 'cell';
  parentId: string | null;
  activityId: string | null;
  categoryKey: string | null;
  programId: string | null;
  sortOrder: number;
  originalCents: number;
  revisionCents: number;
  currentCents: number;
  spentCents: number;
  /** For funder categories: Σ current budgets of its children. */
  childrenCurrentCents: number;
  children: BudgetLineView[];
}

export interface BudgetTree {
  categories: BudgetLineView[];
  /** Working lines and cells without a funder category. */
  loose: BudgetLineView[];
  all: BudgetLineView[];
  activities: Array<{
    id: string;
    name: string;
    aliases: string[];
    plannedCount: number;
    completedCount: number;
    sortOrder: number;
  }>;
  categoryKeys: string[];
  totals: {
    funderCents: number;
    workingOriginalCents: number;
    workingCurrentCents: number;
    spentCents: number;
  };
  runId: string | null;
  revisions: Array<{
    id: string;
    date: Date;
    deltaCents: number;
    budgetLineCode: string;
    counterpartCode: string | null;
    note: string;
    actor: string;
    createdAt: Date;
  }>;
}

/** Spent per budget line from the current run's assigned grant-stage results. */
export async function spentByBudgetLine(
  orgId: string,
  grantId: string,
): Promise<{ runId: string | null; spent: Map<string, number> }> {
  const run = await prisma.computeRun.findFirst({
    where: { orgId, isCurrent: true },
    select: { id: true },
  });
  if (!run) return { runId: null, spent: new Map() };
  const rows = await prisma.grantLineResult.groupBy({
    by: ['budgetLineId'],
    _sum: { amountCents: true },
    where: { computeRunId: run.id, grantId, state: 'assigned', budgetLineId: { not: null } },
  });
  return {
    runId: run.id,
    spent: new Map(rows.map((r) => [r.budgetLineId!, r._sum.amountCents ?? 0])),
  };
}

export async function budgetTree(orgId: string, grantId: string): Promise<BudgetTree> {
  const [lines, activities, revisions, { runId, spent }] = await Promise.all([
    prisma.grantBudgetLine.findMany({
      where: { orgId, grantId },
      orderBy: [{ sortOrder: 'asc' }, { code: 'asc' }],
    }),
    prisma.grantActivity.findMany({
      where: { orgId, grantId },
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
    }),
    prisma.budgetRevision.findMany({
      where: { orgId, grantId },
      orderBy: [{ date: 'asc' }, { createdAt: 'asc' }],
      include: {
        budgetLine: { select: { code: true } },
        counterpart: { select: { code: true } },
      },
    }),
    spentByBudgetLine(orgId, grantId),
  ]);
  const delta = new Map<string, number>();
  for (const r of revisions) {
    delta.set(r.budgetLineId, (delta.get(r.budgetLineId) ?? 0) + r.deltaCents);
    if (r.counterpartLineId)
      delta.set(r.counterpartLineId, (delta.get(r.counterpartLineId) ?? 0) - r.deltaCents);
  }
  const views = new Map<string, BudgetLineView>();
  for (const l of lines) {
    const revisionCents = delta.get(l.id) ?? 0;
    views.set(l.id, {
      id: l.id,
      code: l.code,
      name: l.name,
      kind: l.kind,
      parentId: l.parentId,
      activityId: l.activityId,
      categoryKey: l.categoryKey,
      programId: l.programId,
      sortOrder: l.sortOrder,
      originalCents: l.budgetCents,
      revisionCents,
      currentCents: l.budgetCents + revisionCents,
      spentCents: spent.get(l.id) ?? 0,
      childrenCurrentCents: 0,
      children: [],
    });
  }
  const categories: BudgetLineView[] = [];
  const loose: BudgetLineView[] = [];
  for (const v of views.values()) {
    if (v.kind === 'funder_category') {
      categories.push(v);
      continue;
    }
    const parent = v.parentId ? views.get(v.parentId) : undefined;
    if (parent && parent.kind === 'funder_category') parent.children.push(v);
    else loose.push(v);
  }
  for (const c of categories) {
    c.childrenCurrentCents = c.children.reduce((a, b) => a + b.currentCents, 0);
    c.spentCents = c.children.reduce((a, b) => a + b.spentCents, 0);
  }
  const leaves = [...views.values()].filter((v) => v.kind !== 'funder_category');
  const all = [...views.values()];
  const categoryKeys = [
    ...new Set(leaves.map((l) => l.categoryKey).filter((k): k is string => !!k)),
  ];
  return {
    categories,
    loose,
    all,
    activities,
    categoryKeys,
    totals: {
      funderCents: categories.reduce((a, c) => a + c.currentCents, 0),
      workingOriginalCents: leaves.reduce((a, l) => a + l.originalCents, 0),
      workingCurrentCents: leaves.reduce((a, l) => a + l.currentCents, 0),
      spentCents: leaves.reduce((a, l) => a + l.spentCents, 0),
    },
    runId,
    revisions: revisions.map((r) => ({
      id: r.id,
      date: r.date,
      deltaCents: r.deltaCents,
      budgetLineCode: r.budgetLine.code,
      counterpartCode: r.counterpart?.code ?? null,
      note: r.note,
      actor: r.actor,
      createdAt: r.createdAt,
    })),
  };
}

// --- revisions -----------------------------------------------------------------

export const revisionInputSchema = z.object({
  budgetLineId: z.string().min(1, 'Select a budget line'),
  date: z.date(),
  deltaCents: z
    .number()
    .int()
    .min(-MAX_CENTS)
    .max(MAX_CENTS)
    .refine((n) => n !== 0, 'Amount cannot be zero'),
  counterpartLineId: z.string().nullable(),
  note: z.string().trim().min(1, 'A note is required').max(1000),
});
export type RevisionInput = z.infer<typeof revisionInputSchema>;

export async function addRevision(
  orgId: string,
  grantId: string,
  input: RevisionInput,
  actor = 'local-user',
) {
  const ids = [input.budgetLineId, ...(input.counterpartLineId ? [input.counterpartLineId] : [])];
  const lines = await prisma.grantBudgetLine.findMany({ where: { orgId, grantId, id: { in: ids } } });
  if (!lines.some((l) => l.id === input.budgetLineId))
    throw new ValidationError({ budgetLineId: 'Budget line not found' });
  if (input.counterpartLineId && !lines.some((l) => l.id === input.counterpartLineId))
    throw new ValidationError({ counterpartLineId: 'Counterpart line not found' });
  if (input.counterpartLineId === input.budgetLineId)
    throw new ValidationError({ counterpartLineId: 'Counterpart must be a different line' });
  if (lines.some((l) => l.kind === 'funder_category'))
    throw new ValidationError({ budgetLineId: 'Revise working lines or cells, not categories' });
  return prisma.$transaction(async (tx) => {
    const created = await tx.budgetRevision.create({
      data: { orgId, grantId, ...input, actor },
    });
    await recordAudit(tx, {
      orgId,
      entity: 'BudgetRevision',
      entityId: created.id,
      action: 'create',
      after: created,
      actor,
    });
    return created;
  });
}

// --- activities --------------------------------------------------------------

export const activityInputSchema = z.object({
  name: z.string().trim().min(1, 'Name is required').max(200),
  aliases: z.array(z.string().trim().min(1)).max(50),
  plannedCount: z.number().int().min(0).max(100000),
  completedCount: z.number().int().min(0).max(100000),
  sortOrder: z.number().int().min(0).max(9999),
});
export type ActivityInput = z.infer<typeof activityInputSchema>;

export async function upsertActivity(
  orgId: string,
  grantId: string,
  input: ActivityInput,
  id?: string,
) {
  const grant = await prisma.grant.findFirst({ where: { id: grantId, orgId } });
  if (!grant) throw new ValidationError({ _: 'Grant not found' });
  const dup = await prisma.grantActivity.findFirst({
    where: { grantId, name: input.name, ...(id ? { id: { not: id } } : {}) },
  });
  if (dup) throw new ValidationError({ name: `Activity "${input.name}" already exists` });
  return prisma.$transaction(async (tx) => {
    if (id) {
      const before = await tx.grantActivity.findFirstOrThrow({ where: { id, grantId } });
      const after = await tx.grantActivity.update({ where: { id }, data: input });
      await recordAudit(tx, {
        orgId,
        entity: 'GrantActivity',
        entityId: id,
        action: 'update',
        before,
        after,
      });
      await markCurrentRunStale(tx, orgId);
      return after;
    }
    const created = await tx.grantActivity.create({ data: { orgId, grantId, ...input } });
    await recordAudit(tx, {
      orgId,
      entity: 'GrantActivity',
      entityId: created.id,
      action: 'create',
      after: created,
    });
    await markCurrentRunStale(tx, orgId);
    return created;
  });
}
