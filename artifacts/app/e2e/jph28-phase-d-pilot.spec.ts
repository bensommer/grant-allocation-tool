/**
 * JPH-28 · Phase D on the pilot fixture (pseudonyms): the close checklist reacts to the Phase C
 * bulk accept (AC4) and to the effort true-up round trip (AC5) with no manual recalculation —
 * every number on / comes from a calculation the mutation itself started.
 *
 * Runs in its own Playwright project (`phase-d`, JavaScript on) after `phase-c`; seeds the two
 * pilot grants itself and removes them afterwards, exactly as the Phase C spec does.
 *
 * Golden numbers (cents): Salah needs review 118,841 over 8 rows (7 Leah + one pair) before
 * D1-A (Opioid's only row is a pair netting to zero, so it does not count towards "Review 8"); Opioid coordinator variance 14,353; one drafted true-up of 14,353; after re-importing
 * the export with the posted journal, variance 0 and no drafted entries.
 */
import { execFileSync } from 'node:child_process';
import { expect, test, type Page } from '@playwright/test';
import { prisma } from '../src/lib/db';
import type { Prisma } from '../src/generated/prisma/client';
import { postedExport } from './pilot-posted-export';
import { removeQboReportData } from './qbo-cleanup';

test.describe.configure({ mode: 'serial' });

const SALAH_NAME = 'Salah Foundation — Trauma Programs';
const OPIOID_NAME_PREFIX = 'Opioid';
const SEED_PERIOD_NAMES = ['FY2025'];
const LEAH_TOTAL = 118_841;
const VARIANCE = 14_353;

let orgId: string;
let salahId: string;
let opioidId: string;
let opioidName: string;
let orgSettingsBefore: Prisma.InputJsonValue | undefined;
let seededAt: Date;

test.beforeAll(async () => {
  const org = await prisma.org.findFirstOrThrow({ orderBy: { createdAt: 'asc' } });
  orgId = org.id;
  orgSettingsBefore = org.settings ?? {};
  seededAt = new Date();
  execFileSync('pnpm', ['seed:pilot'], { stdio: 'pipe' });
  salahId = (await prisma.grant.findFirstOrThrow({ where: { orgId, name: SALAH_NAME } })).id;
  const opioid = await prisma.grant.findFirstOrThrow({
    where: { orgId, name: { startsWith: OPIOID_NAME_PREFIX } },
  });
  opioidId = opioid.id;
  opioidName = opioid.name;
  // seed:pilot recomputes through the CLI; make sure the checklist starts from a current run.
  execFileSync('pnpm', ['recompute'], { stdio: 'pipe' });
});

test.afterAll(async () => {
  const ids = [salahId, opioidId].filter(Boolean);
  await prisma.grantLineResult.deleteMany({ where: { grantId: { in: ids } } });
  await prisma.correctingEntryDraft.deleteMany({ where: { grantId: { in: ids } } });
  await prisma.effortSchedule.deleteMany({ where: { grantId: { in: ids } } });
  if (orgSettingsBefore !== undefined)
    await prisma.org.update({ where: { id: orgId }, data: { settings: orgSettingsBefore } });
  await removeQboReportData(orgId);
  await prisma.grant.deleteMany({ where: { id: { in: ids } } });
  await prisma.periodLock.deleteMany({
    where: { orgId, lockedAt: { gte: seededAt }, name: { in: SEED_PERIOD_NAMES } },
  });
  execFileSync('pnpm', ['recompute'], { stdio: 'pipe' });
});

const chip = (page: Page) => page.locator('header.app-header').getByTestId('freshness-chip');
const step = (page: Page, key: string) => page.locator(`[data-step="${key}"]`);
const currentRun = () => prisma.computeRun.findFirstOrThrow({ where: { orgId, isCurrent: true } });

async function manualRunsSince(at: Date) {
  return prisma.computeRun.count({ where: { orgId, trigger: 'manual', startedAt: { gt: at } } });
}

test('AC4: before decisions, step 2 is amber "Review 8" at 118,841; after the Phase C bulk accept (D1-A) it is green with no manual recalculate', async ({
  page,
}) => {
  const start = new Date();
  await page.goto('/');
  const review = step(page, 'review');
  await expect(review).toHaveAttribute('data-tone', 'amber');
  await expect(review.getByTestId('step-review-button')).toHaveText('Review 8');
  await expect(review.getByTestId('step-review-button')).toHaveAttribute('href', '/review');
  await expect(review.getByTestId('step-review-status')).toHaveAttribute(
    'data-cents',
    String(LEAH_TOTAL),
  );
  await expect(review.getByTestId('step-review-status')).toHaveAttribute('data-count', '8');
  // Step 1 is green: the pilot export was imported just now.
  await expect(step(page, 'import')).toHaveAttribute('data-tone', 'green');

  const before = await currentRun();
  await page.goto(`/grants/${salahId}/review`);
  await expect(page.getByTestId('queue')).toHaveAttribute('data-island', 'ready');
  await page.getByLabel('Select all suggested → Leah (Sept+) (7)').check();
  const bulk = page.getByTestId('bulk-bar');
  await expect(bulk.getByTestId('bulk-accept')).toHaveText('Accept 7');
  const t0 = Date.now();
  await bulk.getByTestId('bulk-accept').click();
  await page.waitForURL(/\/review\?saved=1&accepted=7/);
  const elapsedMs = Date.now() - t0;
  await expect(chip(page)).toHaveText('Updated just now');
  const run = await currentRun();
  expect(run.id).not.toBe(before.id);
  expect(run.trigger).toBe('auto');
  expect(run.cause).toBe('7 suggestions accepted');
  console.log(`[JPH-28] bulk accept + auto calculation on the pilot fixture: ${elapsedMs} ms`);

  await page.goto('/');
  await expect(review).toHaveAttribute('data-tone', 'green');
  await expect(review.getByTestId('step-review-status')).toHaveAttribute('data-cents', '0');
  // Salah's ±113.96 pair and Opioid's pair are still listed, but both grants net to zero.
  await expect(review.getByTestId('step-review-status')).toHaveAttribute('data-count', '0');
  await expect(review.getByTestId('step-review-status')).toContainText('2 reversal pairs');
  expect(await manualRunsSince(start)).toBe(0);
});

test('AC5: step 4 amber "$143.53 variance"; after "Draft true-up" step 5 amber "1 entry to post"; after re-importing the posted export, steps 4 and 5 green', async ({
  page,
}) => {
  const start = new Date();
  await page.goto('/');
  const effort = step(page, 'effort');
  const entries = step(page, 'entries');
  await expect(effort).toHaveAttribute('data-tone', 'amber');
  await expect(effort.getByTestId('step-effort-badge')).toHaveText('$143.53 variance');
  await expect(effort.getByTestId('step-effort-status')).toHaveAttribute(
    'data-cents',
    String(VARIANCE),
  );
  await expect(effort.getByTestId('step-effort-button')).toHaveAttribute(
    'href',
    `/grants/${opioidId}/effort`,
  );
  await expect(entries).toHaveAttribute('data-tone', 'green');
  await expect(entries.getByTestId('step-entries-status')).toHaveAttribute('data-count', '0');

  // Destination for the other side of the true-up (restored in afterAll).
  await page.goto('/settings');
  await page.getByLabel('Class').selectOption({ label: 'Youth Programs' });
  await page.getByRole('button', { name: 'Save destination' }).click();
  await page.waitForURL(/\/settings\?saved=1/);

  await page.goto(`/grants/${opioidId}/effort`);
  await page.getByTestId('draft-true-up').getByRole('button', { name: 'Draft true-up' }).click();
  await page.waitForURL(/\/entries\?saved=1&drafted=GAT-\d{4}/);
  const row = page.locator('tr[data-kind="true_up"]');
  await expect(row).toHaveAttribute('data-status', 'drafted');
  const code = (await row.getAttribute('data-code'))!;

  await page.goto('/');
  await expect(effort).toHaveAttribute('data-tone', 'amber');
  await expect(entries).toHaveAttribute('data-tone', 'amber');
  await expect(entries.getByTestId('step-entries-badge')).toHaveText('1 entry to post');
  await expect(entries.getByTestId('step-entries-status')).toHaveAttribute(
    'data-cents',
    String(VARIANCE),
  );
  await expect(entries.getByTestId('step-entries-status')).toHaveAttribute('data-count', '1');
  await expect(entries.getByTestId('step-entries-button')).toHaveAttribute(
    'href',
    `/grants/${opioidId}/entries`,
  );

  // "Post" the entry in QuickBooks: the grant-side row from the CSV lands in the next export
  // as a journal-entry row carrying the code; re-import that export through the UI.
  const csv = await (await page.request.get(`/grants/${opioidId}/entries/${code}/csv`)).text();
  const posted = await postedExport(opioidName, csv);
  const before = await currentRun();
  await page.goto('/import');
  await page.setInputFiles('input[name="report"]', posted);
  await page.selectOption('select[name="grantId"]', opioidId);
  await page.getByRole('button', { name: 'Review report' }).click();
  await page.waitForURL(/\/import\/qbo-report\/[a-z0-9]+$/);
  await expect(page.locator('[data-testid="checksum-row"][data-passed="false"]')).toHaveCount(0);
  await page.getByRole('button', { name: `Import into ${opioidName}` }).click();
  await page.waitForURL(/\/import\/[a-z0-9]+$/);
  await expect(page.locator('main .pill').first()).toContainText('Succeeded');
  await expect(chip(page)).toHaveText('Updated just now');
  const run = await currentRun();
  expect(run.id).not.toBe(before.id);
  expect(run.trigger).toBe('import');

  const draft = await prisma.correctingEntryDraft.findFirstOrThrow({
    where: { grantId: opioidId, code },
  });
  expect(draft.status).toBe('posted');
  await page.goto('/');
  await expect(effort).toHaveAttribute('data-tone', 'green');
  await expect(effort.getByTestId('step-effort-status')).toHaveAttribute('data-cents', '0');
  await expect(entries).toHaveAttribute('data-tone', 'green');
  await expect(entries.getByTestId('step-entries-status')).toHaveAttribute('data-count', '0');
  expect(await manualRunsSince(start)).toBe(0);
});

// --- posted export built from the draft's CSV ---------------------------------------------
