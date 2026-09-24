import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { parse } from 'csv-parse/sync';
import type { Prisma } from '@/generated/prisma/client';
import { prisma } from '@/lib/db';
import { recordAudit, toJson } from '@/lib/audit';
import { parseDateInput } from '@/domain/dates';
import { parseMoneyToCents } from '@/domain/money';
import { type Matchers, matchersSchema } from '@/domain/matchers';

type Row = Record<string, string>;

async function readCsv(dir: string, file: string): Promise<Row[]> {
  const buf = await readFile(path.join(dir, file));
  return parse(buf, { bom: true, columns: true, skip_empty_lines: true, trim: true }) as Row[];
}
const list = (v: string | undefined): string[] =>
  (v ?? '')
    .split('|')
    .map((s) => s.trim())
    .filter(Boolean);

export interface SeedCounts {
  programs: number;
  grants: number;
  budgetLines: number;
  allocationRules: number;
  crosswalkRules: number;
}

/**
 * Loads fixtures/<x>/overlay/*.csv into Layer B. Idempotent: upserts by natural
 * keys (program code, grant name, budget line code, rule name). Requires the
 * source mirror to be imported first (classes/parties/accounts are referenced
 * by external id and resolved to internal ids here).
 */
export async function seedDemoOverlay(orgId: string, overlayDir: string): Promise<SeedCounts> {
  const [programs, grants, budgetLines, allocRules, xwalkRules] = await Promise.all([
    readCsv(overlayDir, 'programs.csv'),
    readCsv(overlayDir, 'grants.csv'),
    readCsv(overlayDir, 'budget_lines.csv'),
    readCsv(overlayDir, 'allocation_rules.csv'),
    readCsv(overlayDir, 'crosswalk_rules.csv'),
  ]);

  const classes = new Map(
    (await prisma.trackingClass.findMany({ where: { orgId } })).map((c) => [c.externalId, c.id]),
  );
  const parties = new Map(
    (await prisma.party.findMany({ where: { orgId } })).map((p) => [p.externalId, p.id]),
  );
  const accounts = new Map(
    (await prisma.account.findMany({ where: { orgId } })).map((a) => [a.externalId, a.id]),
  );
  const need = (m: Map<string, string>, key: string, what: string): string => {
    const id = m.get(key);
    if (!id)
      throw new Error(
        `Overlay seed references unknown ${what} "${key}" — import the source CSVs first`,
      );
    return id;
  };

  const counts: SeedCounts = {
    programs: 0,
    grants: 0,
    budgetLines: 0,
    allocationRules: 0,
    crosswalkRules: 0,
  };

  await prisma.$transaction(
    async (tx) => {
      const programIds = new Map<string, string>();
      for (const r of programs) {
        const data = {
          name: r['name']!,
          description: r['description'] || null,
          functionalCategory: r[
            'functional_category'
          ] as Prisma.ProgramCreateInput['functionalCategory'],
          matchClassIds: list(r['match_class_external_ids']).map((c) => need(classes, c, 'class')),
          active: true,
        };
        const p = await tx.program.upsert({
          where: { orgId_code: { orgId, code: r['code']! } },
          create: { orgId, code: r['code']!, ...data },
          update: data,
        });
        await recordAudit(tx, {
          orgId,
          entity: 'Program',
          entityId: p.id,
          action: 'create',
          after: p,
          actor: 'seed:demo',
        });
        programIds.set(r['code']!, p.id);
        counts.programs++;
      }

      const grantIds = new Map<string, string>();
      for (const r of grants) {
        const funderPartyId = r['funder_party_external_id']
          ? need(parties, r['funder_party_external_id'], 'party')
          : null;
        const funder = funderPartyId
          ? (await tx.party.findUniqueOrThrow({ where: { id: funderPartyId } })).displayName
          : r['name']!;
        const data = {
          funder,
          funderPartyId,
          awardNumber: r['award_number'] || null,
          startDate: parseDateInput(r['start_date']!),
          endDate: parseDateInput(r['end_date']!),
          awardAmountCents: parseMoneyToCents(r['award_amount']!),
          restrictionType: r['restriction_type'] as Prisma.GrantCreateInput['restrictionType'],
          status: (r['status'] || 'active') as Prisma.GrantCreateInput['status'],
          matchPartyIds: list(r['match_party_external_ids']).map((p) => need(parties, p, 'party')),
          matchClassIds: list(r['match_class_external_ids']).map((c) => need(classes, c, 'class')),
        };
        const existing = await tx.grant.findFirst({ where: { orgId, name: r['name']! } });
        const g = existing
          ? await tx.grant.update({ where: { id: existing.id }, data })
          : await tx.grant.create({ data: { orgId, name: r['name']!, ...data } });
        await tx.grantProgram.deleteMany({ where: { grantId: g.id } });
        for (const code of list(r['program_codes'])) {
          await tx.grantProgram.create({
            data: { grantId: g.id, programId: need(programIds, code, 'program') },
          });
        }
        await recordAudit(tx, {
          orgId,
          entity: 'Grant',
          entityId: g.id,
          action: existing ? 'update' : 'create',
          before: existing ?? undefined,
          after: g,
          actor: 'seed:demo',
        });
        grantIds.set(r['code']!, g.id);
        counts.grants++;
      }

      const budgetLineIds = new Map<string, string>();
      for (const r of budgetLines) {
        const grantId = need(grantIds, r['grant_code']!, 'grant');
        const data = {
          name: r['name']!,
          budgetCents: parseMoneyToCents(r['budget']!),
          programId: r['program_code'] ? need(programIds, r['program_code'], 'program') : null,
          sortOrder: Number(r['sort_order'] ?? 0),
        };
        const bl = await tx.grantBudgetLine.upsert({
          where: { grantId_code: { grantId, code: r['code']! } },
          create: { orgId, grantId, code: r['code']!, ...data },
          update: data,
        });
        budgetLineIds.set(`${r['grant_code']}/${r['code']}`, bl.id);
        counts.budgetLines++;
      }

      for (const r of allocRules) {
        const matchers: Matchers = matchersSchema.parse({
          classIds: list(r['match_class_external_ids']).map((c) => need(classes, c, 'class')),
          partyIds: list(r['match_party_external_ids']).map((p) => need(parties, p, 'party')),
          accountIds: list(r['match_account_external_ids']).map((a) =>
            need(accounts, a, 'account'),
          ),
        });
        const existing = await tx.allocationRule.findFirst({ where: { orgId, name: r['name']! } });
        const data = {
          matchers: toJson(matchers),
          method: (r['method'] || 'fixed_pct') as Prisma.AllocationRuleCreateInput['method'],
          priority: Number(r['priority'] ?? 100),
          active: true,
        };
        const rule = existing
          ? await tx.allocationRule.update({ where: { id: existing.id }, data })
          : await tx.allocationRule.create({ data: { orgId, name: r['name']!, ...data } });
        await tx.allocationTarget.deleteMany({ where: { allocationRuleId: rule.id } });
        let sortOrder = 0;
        for (const t of list(r['targets'])) {
          const [code, bps] = t.split(':');
          await tx.allocationTarget.create({
            data: {
              allocationRuleId: rule.id,
              sortOrder: sortOrder++,
              programId: need(programIds, code!, 'program'),
              shareBps: Number(bps),
            },
          });
        }
        await recordAudit(tx, {
          orgId,
          entity: 'AllocationRule',
          entityId: rule.id,
          action: existing ? 'update' : 'create',
          after: rule,
          actor: 'seed:demo',
        });
        counts.allocationRules++;
      }

      for (const r of xwalkRules) {
        const key = `${r['grant_code']}/${r['budget_line_code']}`;
        const grantBudgetLineId = need(budgetLineIds, key, 'budget line');
        const matchers: Matchers = matchersSchema.parse({
          programIds: list(r['program_codes']).map((c) => need(programIds, c, 'program')),
          accountIds: list(r['match_account_external_ids']).map((a) =>
            need(accounts, a, 'account'),
          ),
        });
        const name = key;
        const existing = await tx.crosswalkRule.findFirst({ where: { orgId, name } });
        const data = {
          matchers: toJson(matchers),
          grantBudgetLineId,
          priority: Number(r['priority'] ?? 100),
          active: true,
        };
        const rule = existing
          ? await tx.crosswalkRule.update({ where: { id: existing.id }, data })
          : await tx.crosswalkRule.create({ data: { orgId, name, ...data } });
        await recordAudit(tx, {
          orgId,
          entity: 'CrosswalkRule',
          entityId: rule.id,
          action: existing ? 'update' : 'create',
          after: rule,
          actor: 'seed:demo',
        });
        counts.crosswalkRules++;
      }

      await tx.computeRun.updateMany({ where: { orgId, isCurrent: true }, data: { stale: true } });
    },
    { timeout: 60_000 },
  );
  return counts;
}
