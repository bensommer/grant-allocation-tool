import path from 'node:path';
import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import { prisma } from '@/lib/db';
import { CsvDataSource } from '@/datasource/csv/adapter';
import { FULL_RANGE, runImport } from '@/datasource/import-service';
import { seedDemoOverlay } from '@/seed/demo-overlay';
import { recompute } from '@/engine/recompute';
import { createNarrative } from '@/narratives/service';
import { GET as bvaPdf } from '@/app/grants/[id]/bva/pdf/route';
import { GET as restrictedPdf } from '@/app/restricted/pdf/route';
import { GET as reportPdf } from '@/app/reports/export/pdf/route';
import { GET as narrativePdf } from '@/app/grants/[id]/narratives/[nid]/pdf/route';
import { createTestOrg, resetDatabase } from './helpers';

describe('PDF route exports', () => {
  let grantId: string;
  let narrativeId: string;
  beforeAll(async () => {
    await resetDatabase();
    const orgId = await createTestOrg();
    const demo = path.resolve(__dirname, '../../fixtures/demo');
    expect((await runImport(orgId, new CsvDataSource({ dir: demo }), FULL_RANGE)).status).toBe(
      'succeeded',
    );
    await seedDemoOverlay(orgId, path.join(demo, 'overlay'));
    expect((await recompute(orgId)).status).toBe('succeeded');
    grantId = (await prisma.grant.findFirstOrThrow({ where: { orgId } })).id;
    narrativeId = (
      await createNarrative(
        orgId,
        grantId,
        {
          template: 'Quarterly financial narrative',
          from: '2026-01-01',
          to: '2026-03-31',
          contextNotes: '',
        },
        {
          model: 'test',
          async generate() {
            return { sections: [{ heading: 'Progress', body: 'Expenses progressed as planned.' }] };
          },
        },
      )
    ).id;
  });
  afterAll(() => prisma.$disconnect());

  async function expectPdf(response: Response) {
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('application/pdf');
    const body = Buffer.from(await response.arrayBuffer());
    expect(body.length).toBeGreaterThan(1000);
    expect(body.subarray(0, 4).toString()).toBe('%PDF');
  }

  it('exports a grant BvA', async () => {
    await expectPdf(
      await bvaPdf(new Request(`http://localhost/grants/${grantId}/bva/pdf?asOf=2026-03-31`), {
        params: Promise.resolve({ id: grantId }),
      }),
    );
  });
  it('returns 404 for an unknown grant', async () => {
    expect(
      (
        await bvaPdf(new Request('http://localhost/grants/missing/bva/pdf?asOf=2026-03-31'), {
          params: Promise.resolve({ id: 'missing' }),
        })
      ).status,
    ).toBe(404);
  });
  it('exports restricted balances', async () => {
    await expectPdf(
      await restrictedPdf(new Request('http://localhost/restricted/pdf?asOf=2026-03-31')),
    );
  });
  it('exports a crosstab', async () => {
    await expectPdf(
      await reportPdf(
        new Request(
          'http://localhost/reports/export/pdf?rows=program&cols=glAccount&from=2026-01-01&to=2026-03-31',
        ),
      ),
    );
  });
  it('exports a narrative', async () => {
    await expectPdf(
      await narrativePdf(
        new Request(`http://localhost/grants/${grantId}/narratives/${narrativeId}/pdf`),
        { params: Promise.resolve({ id: grantId, nid: narrativeId }) },
      ),
    );
  });
});
