import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test } from '@playwright/test';
import { prisma } from '../src/lib/db';
import { removeQboReportData } from './qbo-cleanup';

const here = path.dirname(fileURLToPath(import.meta.url));
const SALAH = path.resolve(here, '../fixtures/pilot/salah-export.csv');
const stamp = () => Date.now().toString(36).toUpperCase().slice(-5);

let orgId: string;
let grantId: string;
let grantName: string;

test.beforeAll(async () => {
  const org = await prisma.org.findFirstOrThrow({ orderBy: { createdAt: 'asc' } });
  orgId = org.id;
  grantName = `E2E Grant QBO ${stamp()}`;
  grantId = (
    await prisma.grant.create({
      data: {
        orgId,
        name: grantName,
        funder: 'Salah Foundation',
        startDate: new Date('2026-03-13T00:00:00Z'),
        endDate: new Date('2027-03-12T00:00:00Z'),
        awardAmountCents: 5_000_000,
      },
    })
  ).id;
});

test.afterAll(async () => {
  await removeQboReportData(orgId);
  await prisma.grant.deleteMany({ where: { id: grantId } });
});

test('upload pilot export → confirm page shows passing checksums → import → batch page shows grant totals', async ({
  page,
}) => {
  await page.goto('/import');
  await page.setInputFiles('input[name="report"]', SALAH);
  await page.selectOption('select[name="grantId"]', grantId);
  await page.getByRole('button', { name: 'Review report' }).click();
  await page.waitForURL(/\/import\/qbo-report\/[a-z0-9]+$/);

  const summary = page.getByTestId('report-summary');
  await expect(summary).toContainText('Harborlight Community Organization Inc.');
  await expect(summary.locator('[data-cents="5000000"]')).toHaveCount(1); // income
  await expect(summary.locator('[data-cents="2270881"]')).toHaveCount(1); // expense
  const checksumRows = page.getByTestId('checksum-row');
  expect(await checksumRows.count()).toBeGreaterThan(0);
  await expect(page.locator('[data-testid="checksum-row"][data-passed="false"]')).toHaveCount(0);
  await expect(page.getByLabel('Account type for Contributed income', { exact: true })).toHaveValue(
    'Income',
  );

  await page.getByRole('button', { name: `Import into ${grantName}` }).click();
  await page.waitForURL(/\/import\/[a-z0-9]+$/);
  await expect(page.locator('main .pill').first()).toContainText('Succeeded');
  const scope = page.getByTestId('grant-scope');
  await expect(scope).toContainText(grantName);
  await expect(scope.locator('.scope-income')).toHaveAttribute('data-cents', '5000000');
  await expect(scope.locator('.scope-expense')).toHaveAttribute('data-cents', '2270881');
  await expect(page.locator('[data-testid="checksum-row"][data-passed="false"]')).toHaveCount(0);
  expect(await page.getByTestId('checksum-row').count()).toBeGreaterThan(0);
});

test('an export with a line removed cannot be imported and names the failing total', async ({
  page,
}) => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'qbo-e2e-'));
  try {
    const lines = readFileSync(SALAH, 'utf8').split('\n');
    const first = lines.findIndex((l) => /^,\d{2}\/\d{2}\/\d{4},/.test(l));
    const account = lines[first - 1]!.split(',')[0];
    lines.splice(first, 1);
    const broken = path.join(dir, 'salah-export.csv');
    writeFileSync(broken, lines.join('\n'));

    await page.goto('/import');
    await page.setInputFiles('input[name="report"]', broken);
    await page.selectOption('select[name="grantId"]', grantId);
    await page.getByRole('button', { name: 'Review report' }).click();
    await page.waitForURL(/\/import\/qbo-report\/[a-z0-9]+$/);

    const failing = page.locator('[data-testid="checksum-row"][data-passed="false"]');
    expect(await failing.count()).toBeGreaterThan(0);
    await expect(failing.first()).toContainText(`Total for ${account}`);
    await expect(page.getByRole('button', { name: `Import into ${grantName}` })).toBeDisabled();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
