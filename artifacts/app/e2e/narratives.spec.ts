import { expect, test } from '@playwright/test';
import { prisma } from '../src/lib/db';
import type { GroundingPacket } from '../src/narratives/packet';
import { createNarrative } from '../src/narratives/service';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { formatCents } from '../src/domain/money';

// The running server need not enable the fake-model switch: inject a grounded
// draft through the service, then exercise the full no-JS edit/approve/export UI.
test('edit, approve and download narrative DOCX', async ({ page }) => {
  const org = await prisma.org.findFirstOrThrow({ orderBy: { createdAt: 'asc' } });
  const grant = await prisma.grant.findFirstOrThrow({
    where: { orgId: org.id, awardNumber: 'MWSC-2026-117' },
  });
  const narrative = await createNarrative(
    grant.orgId,
    grant.id,
    {
      template: 'Quarterly financial narrative',
      from: '2026-01-01',
      to: '2026-03-31',
      contextNotes: '',
    },
    {
      model: 'e2e-fake',
      async generate() {
        return {
          sections: [{ heading: 'Spending and pace', body: 'Spending is over pace.' }],
        };
      },
    },
  );
  const packet = narrative.packetJson as unknown as GroundingPacket;
  const spent = formatCents(packet.derived.currency['period.total.actual']!);
  const balance = formatCents(packet.derived.currency['itd.balance']!);
  try {
    await page.goto(`/grants/${grant.id}/narratives/${narrative.id}`);
    await page
      .getByRole('textbox', { name: 'Edit section' })
      .fill(`Spent $${spent}; restricted balance $${balance}. Spending is over pace.`);
    await page.getByRole('button', { name: 'Save edits' }).click();
    await expect(page.getByText('Narrative saved.')).toBeVisible();
    await page.locator('#narrative-editor').getByRole('button', { name: 'Approve' }).click();
    await expect(page.getByText(/Approved by local-user/)).toBeVisible();
    const downloadPromise = page.waitForEvent('download');
    await page.getByRole('link', { name: 'DOCX' }).click();
    const download = await downloadPromise;
    const response = await page.request.get(`/grants/${grant.id}/narratives/${narrative.id}/docx`);
    expect(response.ok()).toBe(true);
    const bytes = await response.body();
    expect(bytes.subarray(0, 2).toString()).toBe('PK');
    const dir = mkdtempSync(join(tmpdir(), 'narrative-docx-'));
    let xml: string;
    try {
      const filename = join(dir, 'narrative.docx');
      writeFileSync(filename, bytes);
      xml = execFileSync('unzip', ['-p', filename, 'word/document.xml'], {
        encoding: 'utf8',
        maxBuffer: 1_000_000,
      });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
    expect(xml).toContain('Spending and pace');
    expect(download.suggestedFilename()).toMatch(/\.docx$/);
  } finally {
    await prisma.auditEvent.deleteMany({
      where: { orgId: grant.orgId, entity: 'Narrative', entityId: narrative.id },
    });
    await prisma.narrative.deleteMany({ where: { id: narrative.id, orgId: grant.orgId } });
  }
});
