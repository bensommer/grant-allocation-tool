import path from 'node:path';
import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import { prisma } from '@/lib/db';
import { CsvDataSource } from '@/datasource/csv/adapter';
import { runImport, FULL_RANGE } from '@/datasource/import-service';
import { seedDemoOverlay } from '@/seed/demo-overlay';
import { recompute } from '@/engine/recompute';
import {
  createAllocationRule,
  updateAllocationRule,
  deleteAllocationRule,
  upsertDriverValues,
  type AllocationInput,
} from '@/services/allocation';
import { createTestOrg, resetDatabase } from './helpers';

describe('allocation service', () => {
  let orgId: string;
  let programs: Array<{ id: string }>;
  let accountId: string;
  beforeAll(async () => {
    await resetDatabase();
    orgId = await createTestOrg();
    const demo = path.resolve(__dirname, '../../fixtures/demo');
    await runImport(orgId, new CsvDataSource({ dir: demo }), FULL_RANGE);
    await seedDemoOverlay(orgId, path.join(demo, 'overlay'));
    programs = await prisma.program.findMany({
      where: { orgId },
      orderBy: { code: 'asc' },
      select: { id: true },
    });
    accountId = (await prisma.account.findFirstOrThrow({ where: { orgId, type: 'Expense' } })).id;
  });
  afterAll(() => prisma.$disconnect());

  const input = (): AllocationInput => ({
    name: 'Service test split',
    matchers: { accountIds: [accountId] },
    method: 'fixed_pct',
    driverKey: null,
    priority: 500,
    effectiveFrom: null,
    effectiveTo: null,
    active: true,
    targets: [
      { sortOrder: 0, programId: programs[0]!.id, grantBudgetLineId: null, shareBps: 5000 },
      { sortOrder: 1, programId: programs[1]!.id, grantBudgetLineId: null, shareBps: 5000 },
    ],
  });

  it('rejects shares not totaling 100%', async () => {
    const candidate = input();
    candidate.targets[1]!.shareBps = 6000;
    await expect(createAllocationRule(orgId, candidate)).rejects.toMatchObject({
      fieldErrors: { targets: expect.stringContaining('Shares must total 100.00%') },
    });
  });
  it('persists sorted targets; update replaces them', async () => {
    const rule = await createAllocationRule(orgId, input());
    expect(rule.targets.map((t) => t.sortOrder).sort()).toEqual([0, 1]);
    const edited = input();
    edited.targets = [
      { sortOrder: 2, programId: programs[2]!.id, grantBudgetLineId: null, shareBps: 10000 },
    ];
    await updateAllocationRule(orgId, rule.id, edited);
    const targets = await prisma.allocationTarget.findMany({
      where: { allocationRuleId: rule.id },
    });
    expect(targets).toHaveLength(1);
    expect(targets[0]!.sortOrder).toBe(2);
  });
  it('deactivates a referenced rule after recompute', async () => {
    const existing = await prisma.allocationRule.findFirstOrThrow({
      where: { orgId, active: true },
    });
    await recompute(orgId);
    const count = await prisma.allocatedLine.count({
      where: { orgId, allocationRuleId: existing.id },
    });
    expect(count).toBeGreaterThan(0);
    expect(await deleteAllocationRule(orgId, existing.id)).toEqual({ deactivated: true });
    expect(
      (await prisma.allocationRule.findUniqueOrThrow({ where: { id: existing.id } })).active,
    ).toBe(false);
  });
  it('upserts driver values idempotently', async () => {
    const rows = [{ programId: programs[0]!.id, value: 30 }];
    await upsertDriverValues(orgId, 'test-hours', '2026-03', rows);
    await upsertDriverValues(orgId, 'test-hours', '2026-03', [{ ...rows[0]!, value: 40 }]);
    const result = await prisma.allocationDriverValue.findMany({
      where: { orgId, driverKey: 'test-hours', period: '2026-03' },
    });
    expect(result).toHaveLength(1);
    expect(result[0]!.value).toBe(40);
  });
});
