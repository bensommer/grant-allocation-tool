import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '@/lib/db';
import { CsvDataSource } from '@/datasource/csv/adapter';
import { FULL_RANGE, runImport } from '@/datasource/import-service';
import { seedDemoOverlay } from '@/seed/demo-overlay';
import { recompute } from '@/engine/recompute';
import {
  createCrosswalkRule,
  deleteCrosswalkRule,
  updateCrosswalkRule,
} from '@/services/crosswalk';
import { createTestOrg, resetDatabase } from './helpers';

const DEMO = path.resolve(__dirname, '../../fixtures/demo');

describe('crosswalk service', () => {
  let orgId: string;
  let mealsId: string;
  let ymId: string;
  let accountId: string;
  beforeAll(async () => {
    await resetDatabase();
    orgId = await createTestOrg();
    await runImport(orgId, new CsvDataSource({ dir: DEMO }), FULL_RANGE);
    await seedDemoOverlay(orgId, path.join(DEMO, 'overlay'));
    mealsId = (await prisma.grantBudgetLine.findFirstOrThrow({ where: { orgId, code: 'MEALS' } }))
      .id;
    ymId = (await prisma.program.findFirstOrThrow({ where: { orgId, code: 'YM' } })).id;
    accountId = (await prisma.account.findFirstOrThrow({ where: { orgId, number: '6110' } })).id;
  });
  afterAll(() => prisma.$disconnect());

  it('validates, creates, updates, audits and deletes unreferenced rules', async () => {
    const input = {
      name: 'Temporary',
      grantBudgetLineId: mealsId,
      priority: 50,
      active: true,
      matchers: { accountIds: [accountId] },
    };
    await expect(createCrosswalkRule(orgId, { ...input, matchers: {} })).rejects.toMatchObject({
      fieldErrors: { matchers: expect.any(String) },
    });
    await expect(createCrosswalkRule(orgId, { ...input, priority: -1 })).rejects.toMatchObject({
      fieldErrors: { priority: expect.any(String) },
    });
    await expect(
      createCrosswalkRule(orgId, { ...input, grantBudgetLineId: 'wrong' }),
    ).rejects.toMatchObject({ fieldErrors: { grantBudgetLineId: expect.any(String) } });
    const created = await createCrosswalkRule(orgId, input);
    await updateCrosswalkRule(orgId, created.id, { ...input, name: 'Edited', active: false });
    expect((await prisma.crosswalkRule.findUniqueOrThrow({ where: { id: created.id } })).name).toBe(
      'Edited',
    );
    const audit = await prisma.auditEvent.findFirstOrThrow({
      where: { orgId, entityId: created.id, action: 'update' },
    });
    expect((audit.after as { name: string }).name).toBe('Edited');
    expect(await deleteCrosswalkRule(orgId, created.id)).toEqual({ deactivated: false });
    expect(await prisma.crosswalkRule.findUnique({ where: { id: created.id } })).toBeNull();
  });

  it('equal priority YM × 6110 causes conflict and MEALS actual drops to zero; referenced rules deactivate', async () => {
    const baseline = await recompute(orgId);
    expect(baseline.status).toBe('succeeded');
    const existing = await prisma.crosswalkRule.findFirstOrThrow({
      where: { orgId, grantBudgetLineId: mealsId, active: true },
    });
    const rival = await createCrosswalkRule(orgId, {
      name: 'Competing YM meals',
      grantBudgetLineId: mealsId,
      priority: existing.priority,
      active: true,
      matchers: { programIds: [ymId], accountIds: [accountId] },
    });
    expect(
      (await prisma.computeRun.findUniqueOrThrow({ where: { id: baseline.runId } })).stale,
    ).toBe(true);
    const result = await recompute(orgId);
    expect(result.status).toBe('succeeded');
    expect(
      await prisma.allocatedLine.count({
        where: {
          orgId,
          computeRunId: result.runId,
          status: 'crosswalk_conflict',
          sourceLine: { accountId },
          programId: ymId,
        },
      }),
    ).toBeGreaterThan(0);
    const actual = await prisma.allocatedLine.aggregate({
      where: { orgId, computeRunId: result.runId, grantBudgetLineId: mealsId, status: 'ok' },
      _sum: { amountCents: true },
    });
    expect(actual._sum.amountCents ?? 0).toBe(0);
    await expect(deleteCrosswalkRule(orgId, existing.id)).resolves.toEqual({ deactivated: true });
    expect(
      (await prisma.crosswalkRule.findUniqueOrThrow({ where: { id: existing.id } })).active,
    ).toBe(false);
    // Rival may be recorded only as a conflictRuleId, not as the chosen crosswalkRuleId.
    expect(rival.id).toBeTruthy();
  });
});
