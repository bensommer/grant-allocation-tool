/**
 * Pilot seed (JPH-21): grants, two-level budgets, activities, cells,
 * revisions, grant rules and manual decisions from fixtures/pilot/seed.json.
 *
 * Idempotent per grant name: an existing grant is re-used and its seeded
 * config replaced (budget lines/activities/rules are matched by code/name).
 * The export CSV is imported when the grant has no active memberships yet.
 * Anything the seed cannot resolve (an account name, a payee, a class that
 * the export does not carry) is reported in `notes`, never silently dropped.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import type { Prisma } from '@/generated/prisma/client';
import { prisma } from '@/lib/db';
import { QboReportDataSource } from '@/datasource/qbo-report/adapter';
import { parseQboReport } from '@/datasource/qbo-report/parser';
import { readReportGrid } from '@/datasource/qbo-report/read';
import { runImport } from '@/datasource/import-service';
import { parseDateInput } from '@/domain/dates';
import { normalizeText, type Matchers } from '@/domain/matchers';
import { upsertBudgetLine } from '@/services/grants';
import { addRevision, upsertActivity } from '@/services/grant-budget';
import { createGrantRule, updateGrantRule, type GrantRuleInput } from '@/services/grant-rules';
import { lineFingerprint, recordDecision } from '@/services/line-decisions';
import { createSchedule, updateSchedule, upsertEntry } from '@/services/effort';

const seedMatchers = z.object({
  accounts: z.array(z.string()).optional(),
  parties: z.array(z.string()).optional(),
  classes: z.array(z.string()).optional(),
  descriptionContainsAny: z.array(z.string()).optional(),
  descriptionContains: z.string().optional(),
  txnTypes: z.array(z.string()).optional(),
  amountSign: z.enum(['positive', 'negative']).optional(),
  dateFrom: z.string().optional(),
  dateTo: z.string().optional(),
});
const selector = z.object({
  accounts: z.array(z.string()).optional(),
  docNumber: z.string().optional(),
  descriptionContainsAny: z.array(z.string()).optional(),
  date: z.string().optional(),
  amountCents: z.number().int().optional(),
});
const cellTarget = z.object({ activity: z.string(), category: z.string() });
const seedGrant = z.object({
  key: z.string(),
  name: z.string(),
  funder: z.string(),
  awardCents: z.number().int(),
  startDate: z.string(),
  endDate: z.string(),
  scope: z.object({
    kind: z.enum(['class', 'project']),
    classPath: z.string().optional(),
    projectName: z.string().optional(),
    note: z.string().optional(),
  }),
  export: z.string(),
  activities: z.array(
    z.object({
      name: z.string(),
      aliases: z.array(z.string()),
      plannedCount: z.number().int(),
      completedCount: z.number().int(),
      sortOrder: z.number().int(),
    }),
  ),
  categories: z.array(
    z.object({
      code: z.string(),
      name: z.string(),
      budgetCents: z.number().int(),
      sortOrder: z.number().int(),
    }),
  ),
  lines: z.array(
    z.object({
      code: z.string(),
      name: z.string(),
      parent: z.string().nullable(),
      budgetCents: z.number().int(),
      sortOrder: z.number().int(),
    }),
  ),
  cellCategories: z.record(z.string(), z.string()).optional(),
  cells: z.array(
    z.object({ activity: z.string(), budgets: z.record(z.string(), z.number().int()) }),
  ),
  revisions: z.array(
    z.object({
      line: z.string(),
      counterpart: z.string().nullable(),
      date: z.string(),
      deltaCents: z.number().int(),
      note: z.string(),
    }),
  ),
  rules: z.array(
    z.object({
      name: z.string(),
      dimension: z.enum(['line', 'activity', 'category']),
      target: z.string(),
      priority: z.number().int(),
      matchers: seedMatchers,
    }),
  ),
  decisions: z.array(
    z.object({
      kind: z.enum(['assign', 'exclude', 'at_risk']),
      target: z.union([z.string(), cellTarget]).optional(),
      reason: z.string().optional(),
      note: z.string(),
      select: selector,
    }),
  ),
  /** Effort schedules (JPH-22). */
  schedules: z
    .array(
      z.object({
        personLabel: z.string(),
        salaryCents: z.number().int().optional(),
        hourlyRate: z.string().optional(),
        burdenBps: z.number().int(),
        targetCategoryKey: z.string(),
        active: z.boolean().default(true),
        actualPayrollMatchers: seedMatchers,
        /** Active exclude decisions with this reason on the matched lines are superseded. */
        supersedesDecisionReason: z.string().optional(),
        entries: z.array(
          z.object({
            activity: z.string(),
            hoursPerOccurrence: z.string(),
            completedCountOverride: z.number().int().optional(),
          }),
        ),
      }),
    )
    .default([]),
});
export const seedFileSchema = z.object({
  $comment: z.string().optional(),
  grants: z.array(seedGrant),
});
export type SeedFile = z.infer<typeof seedFileSchema>;
type SeedGrant = z.infer<typeof seedGrant>;

export interface SeedSummary {
  grants: Array<{
    key: string;
    grantId: string;
    imported: boolean;
    members: number;
    budgetLines: number;
    activities: number;
    rules: number;
    decisions: number;
    revisions: number;
    schedules: number;
  }>;
  notes: string[];
}

export function cellCode(activityIndex: number, categoryKey: string): string {
  return `A${activityIndex + 1}.${categoryKey.toUpperCase()}`;
}

async function importExport(orgId: string, grantId: string, file: string): Promise<void> {
  const fileName = path.basename(file);
  const org = await prisma.org.findUniqueOrThrow({ where: { id: orgId } });
  const grid = await readReportGrid(readFileSync(file), fileName);
  const report = parseQboReport(grid.rows, { fileName });
  if (!report.dateRange) throw new Error(`${fileName}: no date range in the export title rows`);
  const source = new QboReportDataSource({
    report,
    fileName,
    sha256: grid.sha256,
    org: {
      companyName: org.name,
      fiscalYearStartMonth: org.fiscalYearStartMonth,
      currency: org.currency,
    },
  });
  const result = await runImport(orgId, source, report.dateRange, {
    scope: { grantId, dateFrom: report.dateRange.from, dateTo: report.dateRange.to },
  });
  if (result.status !== 'succeeded')
    throw new Error(`${fileName}: import ${result.status}: ${JSON.stringify(result.errors ?? [])}`);
}

class Resolver {
  constructor(
    private readonly orgId: string,
    private readonly notes: string[],
    private readonly ctx: string,
  ) {}

  async accountIds(names: string[]): Promise<string[]> {
    const rows = await prisma.account.findMany({
      where: { orgId: this.orgId, name: { in: names } },
      select: { id: true, name: true },
    });
    for (const n of names)
      if (!rows.some((r) => r.name === n))
        this.notes.push(`${this.ctx}: account "${n}" not found in the imported data`);
    return rows.map((r) => r.id).sort();
  }

  async partyIds(names: string[]): Promise<string[]> {
    const rows = await prisma.party.findMany({
      where: { orgId: this.orgId, displayName: { in: names } },
      select: { id: true, displayName: true },
    });
    for (const n of names)
      if (!rows.some((r) => r.displayName === n))
        this.notes.push(`${this.ctx}: payee "${n}" not found in the imported data`);
    return rows.map((r) => r.id).sort();
  }

  async classIds(paths: string[]): Promise<string[]> {
    const rows = await prisma.trackingClass.findMany({
      where: { orgId: this.orgId, externalId: { in: paths.map((p) => `class:${p}`) } },
      select: { id: true, externalId: true },
    });
    for (const p of paths)
      if (!rows.some((r) => r.externalId === `class:${p}`))
        this.notes.push(`${this.ctx}: class "${p}" not found in the imported data`);
    return rows.map((r) => r.id).sort();
  }

  async matchers(m: z.infer<typeof seedMatchers>): Promise<Matchers> {
    const out: Matchers = {};
    if (m.accounts?.length) out.accountIds = await this.accountIds(m.accounts);
    if (m.parties?.length) out.partyIds = await this.partyIds(m.parties);
    if (m.classes?.length) out.classIds = await this.classIds(m.classes);
    if (m.descriptionContainsAny?.length) out.descriptionContainsAny = m.descriptionContainsAny;
    if (m.descriptionContains) out.descriptionContains = m.descriptionContains;
    if (m.txnTypes?.length) out.txnTypes = m.txnTypes as Matchers['txnTypes'];
    if (m.amountSign) out.amountSign = m.amountSign;
    if (m.dateFrom) out.dateFrom = m.dateFrom;
    if (m.dateTo) out.dateTo = m.dateTo;
    return out;
  }
}

async function seedGrantConfig(
  orgId: string,
  g: SeedGrant,
  dir: string,
  notes: string[],
): Promise<SeedSummary['grants'][number]> {
  const ctx = `grant ${g.key}`;
  let grant = await prisma.grant.findFirst({ where: { orgId, name: g.name } });
  if (!grant) {
    grant = await prisma.grant.create({
      data: {
        orgId,
        name: g.name,
        funder: g.funder,
        startDate: parseDateInput(g.startDate),
        endDate: parseDateInput(g.endDate),
        awardAmountCents: g.awardCents,
        status: 'active',
      },
    });
  }
  const grantId = grant.id;

  // The grant's QuickBooks coding (class full name / project) is what the grant
  // side of a correcting entry must carry; keep it on the grant even when the
  // export has no such row (JPH-22).
  await prisma.grant.update({
    where: { id: grantId },
    data: {
      qboClassName: g.scope.kind === 'class' ? (g.scope.classPath ?? null) : null,
      qboProjectName: g.scope.kind === 'project' ? (g.scope.projectName ?? null) : null,
    },
  });
  // Scope descriptors the export cannot carry are reported, not invented.
  if (g.scope.kind === 'class' && g.scope.classPath) {
    const cls = await prisma.trackingClass.findFirst({
      where: {
        orgId,
        OR: [{ externalId: `class:${g.scope.classPath}` }, { name: g.scope.classPath }],
      },
    });
    if (cls)
      await prisma.grant.update({ where: { id: grantId }, data: { memberClassIds: [cls.id] } });
    else
      notes.push(
        `${ctx}: class "${g.scope.classPath}" is not in the export; membership relies on the import scope`,
      );
  }
  if (g.scope.kind === 'project' && g.scope.projectName) {
    const party = await prisma.party.findFirst({
      where: { orgId, displayName: g.scope.projectName },
    });
    if (party)
      await prisma.grant.update({ where: { id: grantId }, data: { memberPartyIds: [party.id] } });
    else
      notes.push(
        `${ctx}: project "${g.scope.projectName}" is not in the export; membership relies on the import scope`,
      );
  }

  let imported = false;
  const existing = await prisma.grantMembership.count({
    where: { orgId, grantId, supersededAt: null },
  });
  if (existing === 0) {
    await importExport(orgId, grantId, path.join(dir, g.export));
    imported = true;
  }
  const members = await prisma.grantMembership.count({
    where: { orgId, grantId, supersededAt: null },
  });

  // --- activities --------------------------------------------------------------
  const activityId = new Map<string, string>();
  for (const a of g.activities) {
    const current = await prisma.grantActivity.findFirst({ where: { grantId, name: a.name } });
    const row = await upsertActivity(orgId, grantId, a, current?.id);
    activityId.set(a.name, row.id);
  }

  // --- budget lines ------------------------------------------------------------
  const lineId = new Map<string, string>();
  const upsertLine = async (input: {
    code: string;
    name: string;
    budgetCents: number;
    sortOrder: number;
    kind: 'funder_category' | 'working_line' | 'cell';
    parentId: string | null;
    activityId: string | null;
    categoryKey: string | null;
  }) => {
    const current = await prisma.grantBudgetLine.findFirst({
      where: { grantId, code: input.code },
    });
    const row = await upsertBudgetLine(orgId, grantId, { ...input, programId: null }, current?.id);
    lineId.set(input.code, row.id);
    return row;
  };
  for (const c of g.categories)
    await upsertLine({
      ...c,
      kind: 'funder_category',
      parentId: null,
      activityId: null,
      categoryKey: null,
    });
  for (const l of g.lines) {
    const parentId = l.parent ? (lineId.get(l.parent) ?? null) : null;
    if (l.parent && !parentId) notes.push(`${ctx}: line ${l.code}: parent ${l.parent} not found`);
    await upsertLine({ ...l, kind: 'working_line', parentId, activityId: null, categoryKey: null });
  }
  for (let i = 0; i < g.cells.length; i++) {
    const cell = g.cells[i]!;
    const aId = activityId.get(cell.activity);
    if (!aId) {
      notes.push(`${ctx}: cell activity "${cell.activity}" not found`);
      continue;
    }
    const activityIndex = g.activities.findIndex((a) => a.name === cell.activity);
    for (const [categoryKey, budgetCents] of Object.entries(cell.budgets)) {
      const parentCode = g.cellCategories?.[categoryKey];
      const parentId = parentCode ? (lineId.get(parentCode) ?? null) : null;
      await upsertLine({
        code: cellCode(activityIndex, categoryKey),
        name: `${cell.activity} · ${categoryKey}`,
        budgetCents,
        sortOrder: 100 + activityIndex * 10 + Object.keys(cell.budgets).indexOf(categoryKey),
        kind: 'cell',
        parentId,
        activityId: aId,
        categoryKey,
      });
    }
  }
  const cellId = (activity: string, categoryKey: string): string | null => {
    const idx = g.activities.findIndex((a) => a.name === activity);
    return idx < 0 ? null : (lineId.get(cellCode(idx, categoryKey)) ?? null);
  };

  // --- revisions (append-only; skip ones already recorded) --------------------
  let revisions = 0;
  for (const r of g.revisions) {
    const budgetLineId = lineId.get(r.line);
    if (!budgetLineId) {
      notes.push(`${ctx}: revision line ${r.line} not found`);
      continue;
    }
    const counterpartLineId = r.counterpart ? (lineId.get(r.counterpart) ?? null) : null;
    const dup = await prisma.budgetRevision.findFirst({
      where: { grantId, budgetLineId, deltaCents: r.deltaCents, note: r.note },
    });
    if (dup) continue;
    await addRevision(
      orgId,
      grantId,
      {
        budgetLineId,
        counterpartLineId,
        date: parseDateInput(r.date),
        deltaCents: r.deltaCents,
        note: r.note,
      },
      'seed:pilot',
    );
    revisions++;
  }

  // --- rules -------------------------------------------------------------------
  const resolver = new Resolver(orgId, notes, ctx);
  let rules = 0;
  for (const r of g.rules) {
    const input: GrantRuleInput = {
      name: r.name,
      dimension: r.dimension,
      grantBudgetLineId: null,
      targetActivityId: null,
      targetCategoryKey: null,
      priority: r.priority,
      active: true,
      matchers: await resolver.matchers(r.matchers),
    };
    if (r.dimension === 'line') input.grantBudgetLineId = lineId.get(r.target) ?? null;
    else if (r.dimension === 'activity') input.targetActivityId = activityId.get(r.target) ?? null;
    else input.targetCategoryKey = r.target;
    if (r.dimension !== 'category' && !input.grantBudgetLineId && !input.targetActivityId) {
      notes.push(`${ctx}: rule "${r.name}": target "${r.target}" not found`);
      continue;
    }
    const current = await prisma.crosswalkRule.findFirst({
      where: { orgId, grantId, name: r.name },
    });
    if (current) await updateGrantRule(orgId, grantId, current.id, input);
    else await createGrantRule(orgId, grantId, input);
    rules++;
  }

  // --- decisions ---------------------------------------------------------------
  let decisions = 0;
  for (const d of g.decisions) {
    // A placeholder decision that a seeded effort schedule supersedes (JPH-22) is recorded once
    // and then retired below; on later seed runs it is left in its superseded state.
    if (
      d.kind === 'exclude' &&
      d.reason &&
      g.schedules.some((sc) => sc.supersedesDecisionReason === d.reason) &&
      (await prisma.lineDecision.count({ where: { orgId, grantId, reason: d.reason } })) > 0
    )
      continue;
    const ids = await selectMemberLines(orgId, grantId, d.select, resolver);
    if (ids.length === 0) {
      notes.push(`${ctx}: decision "${d.note}" selected no member lines`);
      continue;
    }
    let targetBudgetLineId: string | null = null;
    if (d.kind === 'assign') {
      targetBudgetLineId =
        typeof d.target === 'string'
          ? (lineId.get(d.target) ?? null)
          : d.target
            ? cellId(d.target.activity, d.target.category)
            : null;
      if (!targetBudgetLineId) {
        notes.push(`${ctx}: decision "${d.note}": target not found`);
        continue;
      }
    }
    // Seeded decisions are recorded once. A line that already carries an active decision of the
    // same family (state, or at-risk) is left alone — whether that decision came from an earlier
    // seed run or from a reviewer who overrode it — so re-seeding never supersedes human judgement.
    const fingerprints = (
      await prisma.transactionLine.findMany({
        where: { id: { in: ids } },
        select: { id: true, lineNumber: true, transaction: { select: { externalId: true } } },
      })
    ).map((l) => ({ id: l.id, fp: lineFingerprint(l) }));
    const already = new Set(
      (
        await prisma.lineDecision.findMany({
          where: {
            grantId,
            supersededAt: null,
            kind: d.kind === 'at_risk' ? 'at_risk' : { not: 'at_risk' },
            fingerprint: { in: fingerprints.map((f) => f.fp) },
          },
          select: { fingerprint: true },
        })
      ).map((r) => r.fingerprint),
    );
    const fresh = fingerprints.filter((f) => !already.has(f.fp)).map((f) => f.id);
    if (fresh.length === 0) continue;
    await recordDecision(
      orgId,
      grantId,
      { kind: d.kind, lineIds: fresh, targetBudgetLineId, reason: d.reason ?? null, note: d.note },
      'seed:pilot',
    );
    decisions += fresh.length;
  }

  // --- effort schedules (JPH-22) ------------------------------------------------
  // Seeded before the decisions' "pending effort charge" placeholders are retired: the
  // schedule's matchers now exclude those lines, so the placeholder decisions are
  // superseded (never deleted) and the trail shows why.
  let schedules = 0;
  for (const sc of g.schedules) {
    const input = {
      personLabel: sc.personLabel,
      personPartyId: null,
      salaryCents: sc.salaryCents ?? null,
      hourlyRate: sc.hourlyRate ?? null,
      burdenBps: sc.burdenBps,
      targetCategoryKey: sc.targetCategoryKey,
      actualPayrollMatchers: await resolver.matchers(sc.actualPayrollMatchers),
      active: sc.active,
    };
    const current = await prisma.effortSchedule.findFirst({
      where: { orgId, grantId, personLabel: sc.personLabel },
    });
    const row = current
      ? await updateSchedule(orgId, grantId, current.id, input, 'seed:pilot')
      : await createSchedule(orgId, grantId, input, 'seed:pilot');
    let sortOrder = 0;
    for (const e of sc.entries) {
      const aId = activityId.get(e.activity);
      if (!aId) {
        notes.push(`${ctx}: schedule "${sc.personLabel}": activity "${e.activity}" not found`);
        continue;
      }
      sortOrder += 10;
      await upsertEntry(
        orgId,
        grantId,
        row.id,
        {
          activityId: aId,
          hoursPerOccurrence: e.hoursPerOccurrence,
          completedCountOverride: e.completedCountOverride ?? null,
          sortOrder,
        },
        'seed:pilot',
      );
    }
    if (sc.supersedesDecisionReason) {
      const retired = await prisma.lineDecision.updateMany({
        where: {
          orgId,
          grantId,
          kind: 'exclude',
          reason: sc.supersedesDecisionReason,
          supersededAt: null,
        },
        data: { supersededAt: new Date() },
      });
      if (retired.count > 0)
        notes.push(
          `${ctx}: schedule "${sc.personLabel}" superseded ${retired.count} "${sc.supersedesDecisionReason}" decision(s)`,
        );
    }
    schedules++;
  }

  return {
    key: g.key,
    grantId,
    imported,
    members,
    budgetLines: lineId.size,
    activities: activityId.size,
    rules,
    decisions,
    revisions,
    schedules,
  };
}

/** Seed-only line selector: resolves to current member lines of the grant. */
async function selectMemberLines(
  orgId: string,
  grantId: string,
  sel: z.infer<typeof selector>,
  resolver: Resolver,
): Promise<string[]> {
  const where: Prisma.TransactionLineWhereInput = {
    orgId,
    deletedAt: null,
    memberships: { some: { grantId, supersededAt: null } },
  };
  if (sel.accounts?.length) where.accountId = { in: await resolver.accountIds(sel.accounts) };
  if (sel.amountCents !== undefined) where.amountCents = sel.amountCents;
  const txn: Prisma.TransactionWhereInput = { deletedAt: null };
  if (sel.docNumber) txn.docNumber = sel.docNumber;
  if (sel.date) txn.txnDate = parseDateInput(sel.date);
  where.transaction = txn;
  const rows = await prisma.transactionLine.findMany({
    where,
    select: { id: true, description: true, transaction: { select: { memo: true } } },
    orderBy: { id: 'asc' },
  });
  const needles = (sel.descriptionContainsAny ?? []).map(normalizeText);
  return rows
    .filter((r) => {
      if (needles.length === 0) return true;
      const hay = normalizeText(`${r.description ?? ''} ${r.transaction.memo ?? ''}`);
      return needles.some((n) => hay.includes(n));
    })
    .map((r) => r.id);
}

export async function seedPilot(orgId: string, file: string): Promise<SeedSummary> {
  const raw: unknown = JSON.parse(readFileSync(file, 'utf8'));
  const seed = seedFileSchema.parse(raw);
  const dir = path.dirname(file);
  const notes: string[] = [];
  const grants: SeedSummary['grants'] = [];
  for (const g of seed.grants) grants.push(await seedGrantConfig(orgId, g, dir, notes));
  return { grants, notes };
}
