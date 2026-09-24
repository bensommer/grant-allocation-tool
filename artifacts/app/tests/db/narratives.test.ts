import path from 'node:path';
import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import { prisma } from '@/lib/db';
import { CsvDataSource } from '@/datasource/csv/adapter';
import { FULL_RANGE, runImport } from '@/datasource/import-service';
import { seedDemoOverlay } from '@/seed/demo-overlay';
import { recompute } from '@/engine/recompute';
import type { NarrativeModel } from '@/narratives/client';
import { buildPacket } from '@/narratives/packet';
import { createNarrative, saveNarrative, parseDraft } from '@/narratives/service';
import { createTestOrg, resetDatabase } from './helpers';

describe('grounded narrative lifecycle', () => {
  let orgId: string;
  let grantId: string;
  beforeAll(async () => {
    await resetDatabase();
    orgId = await createTestOrg();
    expect(
      (
        await runImport(
          orgId,
          new CsvDataSource({ dir: path.resolve(__dirname, '../../fixtures/demo') }),
          FULL_RANGE,
        )
      ).status,
    ).toBe('succeeded');
    await seedDemoOverlay(orgId, path.resolve(__dirname, '../../fixtures/demo/overlay'));
    expect((await recompute(orgId)).status).toBe('succeeded');
    grantId = (
      await prisma.grant.findFirstOrThrow({ where: { orgId, awardNumber: 'MWSC-2026-117' } })
    ).id;
  });
  afterAll(() => prisma.$disconnect());
  const fake = (body: string): NarrativeModel => ({
    model: 'test-fake',
    async generate() {
      return { sections: [{ heading: 'Spending and pace', body }] };
    },
  });
  const input = {
    template: 'Quarterly financial narrative' as const,
    from: '2026-01-01',
    to: '2026-03-31',
    contextNotes: '',
  };
  it('grounds the golden Q1 totals and marks them verified', async () => {
    const row = await createNarrative(
      orgId,
      grantId,
      input,
      fake('39,752.91 spent, 20,247.09 restricted balance; spending is over pace.'),
    );
    expect(row.verification).toMatchObject([{ matched: true }, { matched: true }]);
    expect(
      (row.packetJson as { derived: { currency: Record<string, number> } }).derived.currency[
        'period.total.actual'
      ],
    ).toBe(3975291);
    expect(
      (row.packetJson as { derived: { currency: Record<string, number> } }).derived.currency[
        'itd.balance'
      ],
    ).toBe(2024709);
    expect(
      (
        row.packetJson as {
          inceptionToDate: { asOf: string; receivedCents: number; restrictedBalanceCents: number };
        }
      ).inceptionToDate,
    ).toMatchObject({
      asOf: '2026-03-31',
      restrictedBalanceCents: 2024709,
      receivedCents: 6000000,
    });
  });
  it('separates period expense totals from inception-to-date receipts and pacing', async () => {
    const packet = await buildPacket(orgId, grantId, '2026-02-01', '2026-03-31', '');
    expect(packet.period).toEqual({ from: '2026-02-01', to: '2026-03-31' });
    expect(packet.inceptionToDate).toMatchObject({
      asOf: '2026-03-31',
      receivedCents: 6000000,
      restrictedBalanceCents: 2024709,
    });
    expect(packet.derived.currency['period.total.actual']).toBeLessThan(
      packet.inceptionToDate.spentCents,
    );
    expect(packet.derived.currency['itd.spent']).toBe(3975291);
  });
  it('rejects invented figures on approval', async () => {
    const row = await createNarrative(orgId, grantId, input, fake('Invented $41,000.'));
    expect(row.verification).toMatchObject([{ matched: false }]);
    await expect(
      saveNarrative(orgId, grantId, row.id, parseDraft(row.draftJson), [], true),
    ).rejects.toThrow('Acknowledge');
    expect((await prisma.narrative.findUniqueOrThrow({ where: { id: row.id } })).status).toBe(
      'draft',
    );
  });
  it('rejects malformed JSON without saving a draft', async () => {
    const before = await prisma.narrative.count({ where: { orgId, grantId } });
    await expect(
      createNarrative(orgId, grantId, input, {
        model: 'test-fake',
        async generate() {
          return { invalid: true };
        },
      }),
    ).rejects.toThrow();
    expect(await prisma.narrative.count({ where: { orgId, grantId } })).toBe(before);
  });
  it('creates a new version when an approved record is edited', async () => {
    const row = await createNarrative(orgId, grantId, input, fake('39,752.91 spent.'));
    const approved = await saveNarrative(
      orgId,
      grantId,
      row.id,
      parseDraft(row.draftJson),
      [],
      true,
    );
    const next = await saveNarrative(
      orgId,
      grantId,
      row.id,
      { sections: [{ heading: 'Spending', body: 'Revised text.' }] },
      [],
    );
    expect(next).toMatchObject({ status: 'draft', version: approved.version + 1 });
    expect((await prisma.narrative.findUniqueOrThrow({ where: { id: row.id } })).status).toBe(
      'approved',
    );
  });
});
