import { execFileSync } from 'node:child_process';
import { expect, test, type Page } from '@playwright/test';
import { prisma } from '../src/lib/db';
import type { Prisma } from '../src/generated/prisma/client';
import { removeQboReportData } from './qbo-cleanup';

/**
 * JPH-21 rendered-figure checks: the pilot seed is loaded into the demo org, the
 * budget / review / rules pages are asserted on their data-cents attributes
 * (never on summed proxies), and everything the seed wrote is removed again.
 */
const SALAH_NAME = 'Salah Foundation — Trauma Programs';
const OPIOID_NAME_PREFIX = 'Opioid';

/** Appendix 3 Tier 1 — Salah working-line spend, in cents. */
const SALAH_SPENT: Record<string, number> = {
  KIRA: 519_264,
  PRACT: 710_000,
  TRAIN: 146_298,
  FOOD: 92_962,
  LEAH: 90_706,
  DANA: 27_500,
  CULSTAFF: 16_000,
  SUPP: 549_310,
};

/** Appendix 2 Tier 1 — Opioid direct grid plus Program Support, in cents. */
const OPIOID_GRID: Array<[string, Record<string, number>]> = [
  ['Sober Socials', { practitioners: 40_000, food: 51_875, supplies: 0, program_support: 18_744 }],
  ["Daytime Mother's", { practitioners: 300_000, food: 19_824, supplies: 0, program_support: 0 }],
  ['Conference', { practitioners: 100_000, food: 16_796, supplies: 0, program_support: 0 }],
  [
    'Teen Monthly',
    { practitioners: 10_000, food: 103_998, supplies: 4_872, program_support: 49_609 },
  ],
  [
    "Mother's Exhaustion (virtual)",
    { practitioners: 60_000, food: 0, supplies: 15_289, program_support: 0 },
  ],
];

let orgId: string;
let salahId: string;
let opioidId: string;
let orgSettingsBefore: Prisma.InputJsonValue | undefined;

/** JPH-19 §6 F — coordinator charges by activity, in cents. */
const OPIOID_EFFORT: Record<string, number> = {
  "Daytime Mother's": 223_193,
  Conference: 89_277,
  'Teen Monthly': 133_916,
  "Mother's Exhaustion (virtual)": 46_579,
  'Sober Socials': 44_638,
};

test.beforeAll(async () => {
  const org = await prisma.org.findFirstOrThrow({ orderBy: { createdAt: 'asc' } });
  orgId = org.id;
  orgSettingsBefore = org.settings ?? {};
  // The seed CLI imports both exports, writes budgets/rules/decisions and recomputes.
  execFileSync('pnpm', ['seed:pilot'], { stdio: 'pipe' });
  salahId = (await prisma.grant.findFirstOrThrow({ where: { orgId, name: SALAH_NAME } })).id;
  opioidId = (
    await prisma.grant.findFirstOrThrow({
      where: { orgId, name: { startsWith: OPIOID_NAME_PREFIX } },
    })
  ).id;
});

test.afterAll(async () => {
  const ids = [salahId, opioidId].filter(Boolean);
  // Grant-stage results block the transaction delete; import batches reference the grants.
  await prisma.grantLineResult.deleteMany({ where: { grantId: { in: ids } } });
  // JPH-22: drafts reference accounts the cleanup removes; the destination setting is demo state.
  await prisma.correctingEntryDraft.deleteMany({ where: { grantId: { in: ids } } });
  await prisma.effortSchedule.deleteMany({ where: { grantId: { in: ids } } });
  if (orgSettingsBefore !== undefined)
    await prisma.org.update({ where: { id: orgId }, data: { settings: orgSettingsBefore } });
  await removeQboReportData(orgId);
  await prisma.grant.deleteMany({ where: { id: { in: ids } } });
  execFileSync('pnpm', ['recompute'], { stdio: 'pipe' });
});

async function recomputeFromHeader(page: Page) {
  const before = await prisma.computeRun.findFirstOrThrow({ where: { orgId, isCurrent: true } });
  await page.locator('header.app-header').getByRole('button', { name: 'Recompute' }).click();
  await expect
    .poll(
      async () =>
        (await prisma.computeRun.findFirstOrThrow({ where: { orgId, isCurrent: true } })).id,
      { timeout: 60_000 },
    )
    .not.toBe(before.id);
}

test('Salah budget page renders Appendix 3 spend, the 0.61 warning, the funder view and the 1,400 revision', async ({
  page,
}) => {
  await page.goto(`/grants/${salahId}/budget`);
  const tree = page.getByTestId('budget-tree');
  for (const [code, cents] of Object.entries(SALAH_SPENT)) {
    await expect(
      tree.locator(`tr[data-line-code="${code}"] [data-testid="spent"]`),
      code,
    ).toHaveAttribute('data-cents', String(cents));
  }
  // Funder categories sum their working lines (Culinary Staff = Leah + Dana + Culinary Staff).
  await expect(tree.locator('tr[data-line-code="CULINARY"] [data-testid="spent"]')).toHaveAttribute(
    'data-cents',
    String(90_706 + 27_500 + 16_000),
  );
  await expect(tree.locator('tr[data-line-code="FAC"] [data-testid="spent"]')).toHaveAttribute(
    'data-cents',
    String(519_264 + 710_000 + 146_298),
  );
  await expect(page.getByTestId('working-total')).toHaveAttribute('data-cents', '5000061');
  await expect(page.getByTestId('funder-total')).toHaveAttribute('data-cents', '5000000');
  const warning = page.getByTestId('funder-warning');
  await expect(warning).toContainText('over the funder budget');
  await expect(warning.locator('[data-cents="61"]')).toHaveCount(1);
  const history = page.getByTestId('revision-history');
  await expect(
    history.locator('tr[data-revision-line="PRACT"] td[data-cents="140000"]'),
  ).toHaveCount(1);
  await expect(history.locator('tr[data-revision-line="PRACT"]')).toContainText('TRAIN');
});

test('Opioid budget page renders the Appendix 2 grid and Program Support cells', async ({
  page,
}) => {
  await page.goto(`/grants/${opioidId}/budget`);
  const grid = page.getByTestId('cell-grid');
  for (const [activity, cells] of OPIOID_GRID) {
    for (const [key, cents] of Object.entries(cells)) {
      await expect(
        grid.locator(`tr[data-activity="${activity}"] td[data-category="${key}"]`),
        `${activity} / ${key}`,
      ).toHaveAttribute('data-cents', String(cents));
    }
  }
});

test('Salah review queue shows 9 lines netting 1,188.41; confirming the ±113.96 pair leaves 7 "no rule match" lines', async ({
  page,
}) => {
  await page.goto(`/grants/${salahId}/review`);
  await expect(page.getByTestId('needs-review-count')).toHaveText('9 lines');
  await expect(page.getByTestId('review-counts').locator('[data-cents="118841"]')).toHaveCount(1);
  const proposals = page.getByTestId('proposals');
  await expect(proposals.locator('tr[data-pair="11396"]')).toHaveCount(1);
  await expect(proposals.locator('tr[data-pair="10000"]')).toHaveCount(1);

  await proposals
    .locator('tr[data-pair="11396"]')
    .getByRole('button', { name: 'Confirm pair' })
    .click();
  await page.waitForURL(/\/review\?saved=1/);
  await recomputeFromHeader(page);
  await page.goto(`/grants/${salahId}/review`);
  await expect(page.getByTestId('needs-review-count')).toHaveText('7 lines');
  await expect(page.getByTestId('review-counts').locator('[data-cents="118841"]')).toHaveCount(1);
  await expect(page.getByTestId('review-group')).toHaveCount(1);
  await expect(page.getByTestId('review-group')).toContainText('no rule match');
  await expect(page.getByTestId('review-group').locator('th[data-cents="118841"]')).toHaveCount(1);
  await expect(proposals.locator('tr[data-pair="11396"]')).toHaveCount(0);
  await page.goto(`/grants/${salahId}/review?show=all`);
  await expect(
    page.getByTestId('settled').locator('tr[data-state="excluded"]', { hasText: 'reversal pair' }),
  ).toHaveCount(2);
});

test('grant rules list and the edit form with preview render for a seeded rule', async ({
  page,
}) => {
  await page.goto(`/grants/${salahId}/rules`);
  const rows = page.locator('table[data-testid="grant-rules"] tbody tr[data-rule-name]');
  expect(await rows.count()).toBeGreaterThan(0);
  await rows.first().locator('a').click();
  await page.waitForURL(/\/rules\/[a-z0-9]+$/);
  await page.getByRole('button', { name: 'Preview', exact: true }).click();
  await page.waitForURL(/preview=1/);
  await expect(page.getByTestId('rule-preview')).toBeVisible();
});

test('Opioid effort page renders the coordinator schedule, per-activity charges, 16,286.10 charged / 3,713.90 remaining and booked 5,519.56 vs charged 5,376.03', async ({
  page,
}) => {
  await page.goto(`/grants/${opioidId}/effort`);
  const schedule = page.getByTestId('schedule');
  await expect(schedule).toHaveCount(1);
  await expect(schedule.getByTestId('hourly-rate')).toHaveAttribute('data-rate', '36.0577');
  await expect(schedule.getByTestId('burden')).toHaveAttribute('data-bps', '765');
  await expect(schedule.getByTestId('schedule-terms').locator('[data-cents="7500000"]')).toHaveCount(1);
  for (const [activity, cents] of Object.entries(OPIOID_EFFORT)) {
    await expect(
      schedule.locator(`tr[data-activity="${activity.replaceAll('"', '\\"')}"] [data-testid="charge"][data-cents="${cents}"]`),
      activity,
    ).toHaveCount(1);
  }
  await expect(schedule.getByTestId('schedule-total')).toHaveAttribute('data-cents', '537603');
  const totals = page.getByTestId('effort-totals');
  await expect(totals.getByTestId('total-charged').locator('[data-cents]')).toHaveAttribute('data-cents', '1628610');
  await expect(totals.getByTestId('remaining').locator('[data-cents]')).toHaveAttribute('data-cents', '371390');
  const panel = page.getByTestId('booked-vs-charged');
  await expect(panel.getByTestId('booked').locator('[data-cents]')).toHaveAttribute('data-cents', '551956');
  await expect(panel.getByTestId('charged').locator('[data-cents]')).toHaveAttribute('data-cents', '537603');
  await expect(panel.getByTestId('variance').locator('[data-cents]')).toHaveAttribute('data-cents', '14353');

  // Carry variance requires a note and shows the carried amount with it.
  await page.getByTestId('carry-variance').getByLabel('Note (required)').fill('Carried per funder call');
  await page.getByTestId('carry-variance').getByRole('button', { name: 'Carry variance' }).click();
  await page.waitForURL(/\/effort\?saved=1/);
  const carried = page.getByTestId('carried-variance');
  await expect(carried.locator('[data-cents]')).toHaveAttribute('data-cents', '14353');
  await expect(carried).toContainText('Carried per funder call');
});

test('Draft true-up is blocked until Settings has a default destination, then drafts a 143.53 entry that lists on the entries page with CSV/PDF links and can be voided with a note', async ({
  page,
  request,
}) => {
  await page.goto(`/grants/${opioidId}/effort`);
  await page.getByTestId('draft-true-up').getByRole('button', { name: 'Draft true-up' }).click();
  await page.waitForURL(/\/effort\?blocked=1/);
  await expect(page.getByTestId('draft-blocked')).toBeVisible();
  await expect(page.getByTestId('draft-blocked')).toContainText('default destination');

  await page.goto('/settings');
  await expect(page.getByTestId('destination-unset')).toBeVisible();
  const classes = page.getByLabel('Class');
  await classes.selectOption({ label: 'Youth Programs' });
  await page.getByRole('button', { name: 'Save destination' }).click();
  await page.waitForURL(/\/settings\?saved=1/);
  await expect(page.getByTestId('destination-unset')).toHaveCount(0);

  await page.goto(`/grants/${opioidId}/effort`);
  await page.getByTestId('draft-true-up').getByRole('button', { name: 'Draft true-up' }).click();
  await page.waitForURL(/\/entries\?saved=1&drafted=GAT-\d{4}/);
  await expect(page.getByTestId('draft-created')).toBeVisible();
  const row = page.locator('tr[data-kind="true_up"]');
  await expect(row).toHaveCount(1);
  await expect(row).toHaveAttribute('data-status', 'drafted');
  await expect(row.getByTestId('amount')).toHaveAttribute('data-cents', '14353');
  const code = (await row.getAttribute('data-code'))!;
  expect(code).toMatch(/^GAT-\d{4}$/);

  const csv = await request.get(`/grants/${opioidId}/entries/${code}/csv`);
  expect(csv.status()).toBe(200);
  expect(csv.headers()['content-type']).toContain('text/csv');
  const body = await csv.text();
  expect(body.split(/\r?\n/)[0]).toBe(
    '"Journal No.","Journal Date","Account Name","Journal/Description","Debits","Credits","Name","Class","Location"',
  );
  expect(body).toContain('"143.53"');
  // Grant side coded to the grant's QuickBooks project; the other side to the destination class.
  const rows = body.trim().split(/\r?\n/).slice(1);
  expect(rows).toHaveLength(2);
  expect(rows[0]).toContain('"2025-2026 Opioid Grant"');
  expect(rows[1]).toContain('"Youth Programs"');
  const pdf = await request.get(`/grants/${opioidId}/entries/${code}/pdf`);
  expect(pdf.status()).toBe(200);
  expect(pdf.headers()['content-type']).toContain('application/pdf');

  const voidForm = page.getByTestId('void-form');
  await voidForm.getByLabel('Note (required)').fill('Drafted in error');
  await voidForm.getByRole('button', { name: 'Void draft' }).click();
  await page.waitForURL(/\/entries\?saved=1/);
  await expect(page.locator(`tr[data-code="${code}"]`)).toHaveAttribute('data-status', 'void');
  await expect(page.locator(`tr[data-code="${code}"]`)).toContainText('Drafted in error');
  await expect(page.getByTestId('void-form')).toHaveCount(0);
});

test('Excluding the 7 pre-September Leah lines with "Draft correcting entry" drafts one balanced 1,188.41 reclass on Salah', async ({
  page,
}) => {
  await page.goto(`/grants/${salahId}/review`);
  await expect(page.getByTestId('needs-review-count')).toHaveText('7 lines');
  const group = page.getByTestId('review-group');
  const boxes = group.getByRole('checkbox', { name: /^Select / });
  await expect(boxes).toHaveCount(7);
  for (let i = 0; i < 7; i++) await boxes.nth(i).check();
  const form = page.locator('#decision-form');
  await form.getByLabel('Decision').selectOption('exclude');
  await form.getByLabel('Reason (required to exclude)').fill('not allowable');
  await expect(form.getByLabel('Draft correcting entry (when excluding)')).toBeChecked();
  await form.getByLabel('Note (required)').fill('D1-B: pre-September payroll is outside the award period');
  await form.getByRole('button', { name: 'Record decision' }).click();
  await page.waitForURL(/\/review\?saved=1&drafted=GAT-\d{4}/);
  await expect(page.getByTestId('draft-created')).toBeVisible();

  await page.goto(`/grants/${salahId}/entries`);
  const row = page.locator('tr[data-kind="reclass"]');
  await expect(row).toHaveCount(1);
  await expect(row).toHaveAttribute('data-status', 'drafted');
  await expect(row.getByTestId('amount')).toHaveAttribute('data-cents', '118841');
  const draft = await prisma.correctingEntryDraft.findFirstOrThrow({
    where: { grantId: salahId, kind: 'reclass' },
    include: { lines: true },
  });
  expect(draft.lines.reduce((s, l) => s + l.debitCents, 0)).toBe(118_841);
  expect(draft.lines.reduce((s, l) => s + l.creditCents, 0)).toBe(118_841);
});
