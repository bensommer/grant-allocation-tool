import { execFileSync } from 'node:child_process';
import { expect, test, type Page } from '@playwright/test';
import { prisma } from '../src/lib/db';
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

test.beforeAll(async () => {
  const org = await prisma.org.findFirstOrThrow({ orderBy: { createdAt: 'asc' } });
  orgId = org.id;
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
