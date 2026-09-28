/**
 * JPH-29 · Phase E on the pilot fixture (pseudonyms): the golden Budget vs. Actuals figures
 * under both views (AC2), the Opioid activity grid on the Status tab (AC5), the To do tab
 * before and after decisions (AC6), the Setup attention dot (AC7), the one tracking block on
 * the edit page (AC8) and the wizard reproducing seed:pilot for Salah (AC9).
 *
 * Runs in its own Playwright project (`phase-e`, JavaScript on) after `phase-d`; seeds the two
 * pilot grants itself and removes them afterwards, exactly as the Phase C / D specs do. Tests
 * are serial: the bulk accept (D1-A) and the posted true-up change the figures later tests read.
 *
 * Golden numbers (cents, JPH-29): after D1-A Salah's funder categories charge Facilitators &
 * Trauma Informed 1,375,562 · Food & Beverage 92,962 · Supplies 549,310 · Culinary Staff
 * 253,047; working lines Kira 519,264 · Practitioners 710,000 · Training 146,298 · Food 92,962
 * · Leah (Sept+) 209,547 · Dana 27,500 · Culinary Staff 16,000 · Supplies 549,310; the working
 * budget exceeds the funder budget by 61 cents. Opioid grid: Teen Monthly 40,000 / 10,533 per
 * remaining occurrence, Sober Socials 30,000 / 29,063, Mother's Exhaustion over by 15,289.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test, type Page } from '@playwright/test';
import { prisma } from '../src/lib/db';
import type { Prisma } from '../src/generated/prisma/client';
import { postedExport } from './pilot-posted-export';
import { removeQboReportData } from './qbo-cleanup';

test.describe.configure({ mode: 'serial' });

const SALAH_NAME = 'Salah Foundation — Trauma Programs';
const OPIOID_NAME_PREFIX = 'Opioid';
const SEED_PERIOD_NAMES = ['FY2025'];
const here = path.dirname(fileURLToPath(import.meta.url));
const SEED_FILE = path.resolve(here, '../fixtures/pilot/seed.json');

/** Salah working-line spend after D1-A (Leah = 90,706 + the 118,841 accepted). */
const SALAH_LINES_AFTER: Record<string, number> = {
  KIRA: 519_264,
  PRACT: 710_000,
  TRAIN: 146_298,
  FOOD: 92_962,
  LEAH: 209_547,
  DANA: 27_500,
  CULSTAFF: 16_000,
  SUPP: 549_310,
};
const SALAH_CATEGORIES_AFTER: Record<string, number> = {
  FAC: 1_375_562,
  FOODBEV: 92_962,
  SUPPLIES: 549_310,
  CULINARY: 253_047,
};
/** The same lines before any decision (what seed:pilot alone produces; Leah = 90,706). */
const SALAH_LINES_SEEDED: Record<string, number> = { ...SALAH_LINES_AFTER, LEAH: 90_706 };
const SALAH_SPENT_SEEDED = Object.values(SALAH_LINES_SEEDED).reduce((a, b) => a + b, 0);
const SALAH_SPENT_AFTER = Object.values(SALAH_LINES_AFTER).reduce((a, b) => a + b, 0);
const WORKING_MINUS_FUNDER = 61;

interface SeedGrant {
  key: string;
  name: string;
  funder: string;
  startDate: string;
  endDate: string;
  awardCents: number;
  categories: { code: string; name: string; budgetCents: number }[];
  lines: { code: string; name: string; parent: string; budgetCents: number }[];
  scope: { kind: string; classPath?: string };
}
const seedSalah = (): SeedGrant =>
  (JSON.parse(readFileSync(SEED_FILE, 'utf8')) as { grants: SeedGrant[] }).grants.find(
    (g) => g.key === 'salah',
  )!;

let orgId: string;
let salahId: string;
let opioidId: string;
let opioidName: string;
let orgSettingsBefore: Prisma.InputJsonValue | undefined;
let seededAt: Date;

async function seedPilot() {
  execFileSync('pnpm', ['seed:pilot'], { stdio: 'pipe' });
  salahId = (await prisma.grant.findFirstOrThrow({ where: { orgId, name: SALAH_NAME } })).id;
  const opioid = await prisma.grant.findFirstOrThrow({
    where: { orgId, name: { startsWith: OPIOID_NAME_PREFIX } },
  });
  opioidId = opioid.id;
  opioidName = opioid.name;
  execFileSync('pnpm', ['recompute'], { stdio: 'pipe' });
}

async function removePilot() {
  const ids = (
    await prisma.grant.findMany({
      where: { orgId, OR: [{ name: SALAH_NAME }, { name: { startsWith: OPIOID_NAME_PREFIX } }] },
      select: { id: true },
    })
  ).map((g) => g.id);
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
  await prisma.grantDraft.deleteMany({ where: { orgId, createdAt: { gte: seededAt } } });
  execFileSync('pnpm', ['recompute'], { stdio: 'pipe' });
}

test.beforeAll(async () => {
  const org = await prisma.org.findFirstOrThrow({ orderBy: { createdAt: 'asc' } });
  orgId = org.id;
  orgSettingsBefore = org.settings ?? {};
  seededAt = new Date();
  await seedPilot();
});

test.afterAll(async () => {
  await removePilot();
});

const chip = (page: Page) => page.locator('header.app-header').getByTestId('freshness-chip');
const cents = (loc: ReturnType<Page['locator']>, value: number) =>
  expect(loc).toHaveAttribute('data-cents', String(value));

async function expectSalahBva(page: Page, lines: Record<string, number>, spent: number) {
  const categories = {
    ...SALAH_CATEGORIES_AFTER,
    CULINARY: lines['LEAH']! + lines['DANA']! + lines['CULSTAFF']!,
  };
  // Funder view (budget as awarded): the four categories only, funder totals.
  await page.goto(`/grants/${salahId}/bva?view=funder`);
  await expect(page.getByTestId('bva-view-toggle')).toHaveAttribute('data-view', 'funder');
  await expect(page.locator('tr[data-testid="funder-category"]')).toHaveCount(4);
  await expect(page.locator('tr[data-testid="working-line"]')).toHaveCount(0);
  for (const [code, value] of Object.entries(categories))
    await cents(
      page.locator(
        `tr[data-testid="funder-category"][data-code="${code}"] [data-testid="category-charged"]`,
      ),
      value,
    );
  await cents(page.getByTestId('funder-charged'), spent);
  await cents(page.getByTestId('funder-budget'), 5_000_000);
  // Internal view (how we track it): the eight lines nested under their category.
  await page.goto(`/grants/${salahId}/bva?view=internal`);
  await expect(page.getByTestId('bva-view-toggle')).toHaveAttribute('data-view', 'internal');
  await expect(page.locator('tr[data-testid="working-line"]')).toHaveCount(8);
  for (const [code, value] of Object.entries(lines))
    await cents(
      page.locator(
        `tr[data-testid="working-line"][data-code="${code}"] [data-testid="line-charged"]`,
      ),
      value,
    );
  for (const [code, value] of Object.entries(categories))
    await cents(
      page.locator(
        `tr[data-testid="working-category"][data-code="${code}"] [data-testid="category-charged"]`,
      ),
      value,
    );
  await cents(page.getByTestId('total-charged'), spent);
  // The internal view rolls up into the funder totals; the 61-cent difference is the Setup dot.
  await cents(page.getByTestId('total-budget'), 5_000_000);
}

test('AC6 (before): Salah To do shows "Review · 8" first, the tab badge counts 7 decisions', async ({
  page,
}) => {
  await page.goto(`/grants/${salahId}/todo`);
  await expect(page.getByTestId('todo-header')).toHaveAttribute('data-open', '7');
  await expect(page.getByTestId('todo-header')).toContainText('7 items need a decision');
  await expect(page.getByTestId('review-tab-count')).toHaveAttribute('data-count', '7');
  const cards = page.locator('main .card');
  await expect(cards.first().locator('h2, h3').first()).toHaveText('Review · 8');
  await expect(page.getByTestId('todo-review')).toHaveAttribute('data-count', '7');
  await expect(page.getByTestId('todo-review')).toHaveAttribute('data-pairs', '1');
  await expect(page.getByTestId('todo-accept-all')).toBeVisible();
  // The two other sections are green one-liners already.
  await expect(page.getByTestId('todo-effort').getByTestId('todo-green')).toBeVisible();
  await expect(page.getByTestId('todo-drafts').getByTestId('todo-green')).toBeVisible();
});

test('AC7: the Setup tab carries the 61-cent attention dot for Salah and none for Opioid', async ({
  page,
}) => {
  await page.goto(`/grants/${salahId}`);
  const dot = page.getByTestId('grant-tabs').getByTestId('setup-dot');
  await expect(dot).toHaveCount(1);
  await expect(dot).toHaveAttribute('data-difference-cents', String(WORKING_MINUS_FUNDER));
  await page.goto(`/grants/${opioidId}`);
  await expect(page.getByTestId('grant-tabs').getByTestId('setup-dot')).toHaveCount(0);
});

test('AC5: the Opioid Status tab renders the activity × category grid at the golden figures', async ({
  page,
}) => {
  await page.goto(`/grants/${opioidId}`);
  const cell = (activity: string, code: string) =>
    page.locator(`tr[data-activity="${activity}"] td[data-code="${code}"]`);
  const per = (activity: string, code: string) =>
    cell(activity, code).locator('.cell-per-occurrence');
  await cents(per('Teen Monthly', 'PRACT'), 40_000);
  await cents(per('Teen Monthly', 'FOODSUPP'), 10_533);
  await cents(per('Sober Socials', 'PRACT'), 30_000);
  await cents(per('Sober Socials', 'FOODSUPP'), 29_063);
  const me = cell("Mother's Exhaustion (virtual)", 'FOODSUPP');
  await expect(me).toHaveAttribute('data-over', '1');
  await cents(me.locator('.cell-remaining'), -15_289);
  await expect(page.locator('tr[data-activity]')).toHaveCount(5);
});

test('AC8: /edit shows one "How QuickBooks tracks this grant" block with Class = Trauma Grants; the six old fields are gone; saving keeps memberClassIds', async ({
  page,
}) => {
  const before = await prisma.grant.findUniqueOrThrow({ where: { id: salahId } });
  await page.goto(`/grants/${salahId}/edit`);
  await expect(page.getByTestId('tracking-block')).toHaveCount(1);
  await expect(page.getByTestId('tracking-block')).toHaveAttribute('data-choice', 'class');
  await expect(page.getByTestId('tracking-choice-class')).toBeChecked();
  await expect(page.getByTestId('tracking-class').locator('option:checked')).toHaveText(
    /^Trauma Grants/,
  );
  await expect(page.getByTestId('grant-income-block')).toHaveCount(1);
  // The six fields the block replaced: two membership checkbox lists, two free-text QuickBooks
  // names (now derived, behind Override) and the two income matchers (now the Grant income
  // block, under their own names).
  for (const label of [
    'Grant membership — classes',
    'Grant membership — customers / projects',
    'QuickBooks class',
    'QuickBooks project / customer',
    'Funder customer names',
    'Income classes',
  ])
    await expect(page.getByLabel(label, { exact: true }), label).toHaveCount(0);
  await expect(page.getByText('Grant membership —')).toHaveCount(0);
  for (const name of ['qboClassName', 'qboProjectName'])
    await expect(page.locator(`input[name="${name}"], select[name="${name}"]`), name).toHaveCount(
      0,
    );
  await expect(
    page.locator(
      'input[type="checkbox"][name="memberClassIds"], input[type="checkbox"][name="memberPartyIds"], select[name="memberClassIds"], select[name="memberPartyIds"]',
    ),
  ).toHaveCount(0);
  const income = page.getByTestId('grant-income-block');
  await expect(
    income.locator('input[type="checkbox"][name="matchPartyIds"]').first(),
  ).toBeAttached();
  await expect(
    income.locator('input[type="checkbox"][name="matchClassIds"]').first(),
  ).toBeAttached();
  await page.getByRole('button', { name: 'Save changes' }).click();
  await page.waitForURL(new RegExp(`/grants/${salahId}\\?saved=1$`));
  const after = await prisma.grant.findUniqueOrThrow({ where: { id: salahId } });
  expect(after.memberClassIds).toEqual(before.memberClassIds);
  expect(after.memberPartyIds).toEqual(before.memberPartyIds);
  expect(after.qboClassName).toBe('Trauma Grants');
  expect(after.trackingMode).toBe(before.trackingMode);
});

test('AC2 / AC3: after D1-A, /bva?view=funder and ?view=internal show the golden figures; /funder and /working redirect; exports carry the view', async ({
  page,
}) => {
  // D1-A: accept the seven Leah suggestions from the review queue (Phase C island).
  await page.goto(`/grants/${salahId}/review`);
  await expect(page.getByTestId('queue')).toHaveAttribute('data-island', 'ready');
  await page.getByLabel('Select all suggested → Leah (Sept+) (7)').check();
  await page.getByTestId('bulk-bar').getByTestId('bulk-accept').click();
  await page.waitForURL(/\/review\?saved=1&accepted=7/);
  await expect(chip(page)).toHaveText('Updated just now');

  await expectSalahBva(page, SALAH_LINES_AFTER, SALAH_SPENT_AFTER);
  for (const [old, view] of [
    ['funder', 'funder'],
    ['working', 'internal'],
  ]) {
    const res = await page.request.get(`/grants/${salahId}/${old}`, { maxRedirects: 0 });
    expect(res.status(), old).toBe(302);
    expect(res.headers()['location']).toBe(`/grants/${salahId}/bva?view=${view}`);
  }
  for (const view of ['funder', 'internal']) {
    await page.goto(`/grants/${salahId}/bva?view=${view}`);
    for (const kind of ['csv', 'xlsx', 'pdf']) {
      const href = (await page.getByTestId(`bva-export-${kind}`).getAttribute('href'))!;
      const res = await page.request.get(href);
      expect(res.status(), href).toBe(200);
      expect(res.headers()['content-disposition'], href).toContain(view);
      if (kind !== 'csv') continue;
      // The download says what the page says: funder view = the four categories and their
      // totals, no working lines beneath them; internal view = the working lines.
      const cells = (await res.text())
        .trim()
        .split(/\r?\n/)
        .map((line) => line.replace(/^"|"$/g, '').split('","'));
      if (view === 'funder') {
        expect(cells.slice(2).map((r) => r[0])).toEqual([
          'Facilitators & Trauma Informed',
          'Food & Beverage',
          'Culinary Staff',
          'Supplies',
          'Total',
        ]);
      } else {
        const names = cells.slice(2).map((r) => r[1]);
        for (const line of ['Practitioners', 'Training', 'Leah (Sept+)'])
          expect(names, `${view} csv has ${line}`).toContain(line);
      }
    }
  }
});

test('AC6 (after): once D1-A is accepted and the Opioid true-up is posted, every To do section is a green one-liner under "Nothing to do —"', async ({
  page,
}) => {
  await page.goto(`/grants/${salahId}/todo`);
  await expect(page.getByTestId('todo-header')).toHaveAttribute('data-open', '0');
  await expect(page.getByTestId('todo-header')).toContainText(/Nothing to do\s+—/);
  await expect(page.getByTestId('todo-green')).toHaveCount(3);
  await expect(page.getByTestId('todo-review')).toHaveAttribute('data-count', '0');
  await expect(page.getByTestId('todo-review-row')).toHaveCount(0);
  await expect(page.getByTestId('review-tab-count')).toHaveCount(0);

  // Opioid: one staff-time variance → draft the true-up → re-import the posted export.
  await page.goto(`/grants/${opioidId}/todo`);
  await expect(page.getByTestId('todo-effort')).toHaveAttribute('data-count', '1');
  await page.goto('/settings');
  await page.getByLabel('Class').selectOption({ label: 'Youth Programs' });
  await page.getByRole('button', { name: 'Save destination' }).click();
  await page.waitForURL(/\/settings\?saved=1/);
  await page.goto(`/grants/${opioidId}/effort`);
  await page.getByTestId('draft-true-up').getByRole('button', { name: 'Draft true-up' }).click();
  await page.waitForURL(/\/entries\?saved=1&drafted=GAT-\d{4}/);
  const code = (await page.locator('tr[data-kind="true_up"]').getAttribute('data-code'))!;
  await page.goto(`/grants/${opioidId}/todo`);
  await expect(page.getByTestId('todo-drafts')).toHaveAttribute('data-count', '1');
  await expect(page.getByTestId('todo-header')).toHaveAttribute('data-open', '2');

  const csv = await (await page.request.get(`/grants/${opioidId}/entries/${code}/csv`)).text();
  const posted = await postedExport(opioidName, csv);
  await page.goto('/import');
  await page.setInputFiles('input[name="report"]', posted);
  await page.selectOption('select[name="grantId"]', opioidId);
  await page.getByRole('button', { name: 'Review report' }).click();
  await page.waitForURL(/\/import\/qbo-report\/[a-z0-9]+$/);
  await page.getByRole('button', { name: `Import into ${opioidName}` }).click();
  await page.waitForURL(/\/import\/[a-z0-9]+$/);
  await expect(chip(page)).toHaveText('Updated just now');

  await page.goto(`/grants/${opioidId}/todo`);
  await expect(page.getByTestId('todo-header')).toHaveAttribute('data-open', '0');
  await expect(page.getByTestId('todo-header')).toContainText(/Nothing to do\s+—/);
  await expect(page.getByTestId('todo-green')).toHaveCount(3);
});

test('AC9: the wizard, given the Salah award, "Trauma Grants", the four categories and eight lines, reproduces seed:pilot (golden Status figures, 7 transactions in review)', async ({
  page,
}) => {
  test.setTimeout(300_000);
  // Start from nothing: remove the seeded pilot grants and their import.
  await removePilot();
  await prisma.grantDraft.deleteMany({ where: { orgId } });
  const seed = seedSalah();

  // Step 1 — the award.
  await page.goto('/grants/new');
  await expect(page).toHaveURL(/\/grants\/new\/1$/);
  await page.fill('#name', seed.name);
  await page.fill('#funderText', seed.funder);
  await page.fill('#awardAmount', (seed.awardCents / 100).toFixed(2));
  await page.fill('#startDate', seed.startDate);
  await page.fill('#endDate', seed.endDate);
  await page.getByTestId('wizard-continue').click();
  await expect(page).toHaveURL(/\/grants\/new\/2$/);

  // Step 2 — the export carries no class column, so "Trauma Grants" is not a class in the
  // imported books: choose "Neither" (the grant's transactions come from its own report
  // import) and record the QuickBooks class name behind Override, as seed:pilot does.
  await page.getByTestId('tracking-choice-neither').check();
  await page.getByTestId('tracking-override').locator('summary').click();
  await page.fill('#qboClassNameOverride', seed.scope.classPath!);
  await page.getByTestId('wizard-continue').click();
  await expect(page).toHaveURL(/\/grants\/new\/3$/);

  // Step 3 — the four funder categories, pasted with their codes.
  await page.fill(
    '[data-testid="budget-paste"]',
    seed.categories
      .map((c) => `${c.code}\t${c.name}\t${(c.budgetCents / 100).toFixed(2)}`)
      .join('\n'),
  );
  await page.getByTestId('budget-paste-apply').click();
  await expect(page.getByTestId('budget-total-chip')).toHaveAttribute(
    'data-cents',
    String(seed.awardCents),
  );
  await expect(page.getByTestId('budget-total-chip')).toHaveAttribute('data-difference-cents', '0');
  await page.getByTestId('wizard-continue').click();
  await expect(page).toHaveURL(/\/grants\/new\/4$/);

  // Step 4 — the eight working lines under their categories.
  await page.getByTestId('lines-yes').check();
  await page.getByTestId('wizard-continue').click();
  await expect(page.getByTestId('lines-category')).toHaveCount(4);
  const perCategory = Math.max(
    ...seed.categories.map((c) => seed.lines.filter((l) => l.parent === c.code).length),
  );
  const firstBlock = page.locator('[data-testid="lines-category"]').first();
  const names = firstBlock.locator('input[name="lineName"]');
  await expect(names).toHaveCount(2); // the prefilled line plus one blank row
  for (let have = 2; have < perCategory; have++) {
    // The action redirects back to the same URL; wait for the re-render, not the URL.
    await page.getByTestId('lines-add-rows').click();
    await expect(names).toHaveCount(have + 1);
  }
  for (const c of seed.categories) {
    const mine = seed.lines.filter((l) => l.parent === c.code);
    const block = page.locator(`[data-testid="lines-category"][data-code="${c.code}"]`);
    for (const [i, l] of mine.entries()) {
      await block.locator('input[name="lineCode"]').nth(i).fill(l.code);
      await block.locator('input[name="lineName"]').nth(i).fill(l.name);
      await block
        .locator('input[name="lineAmount"]')
        .nth(i)
        .fill((l.budgetCents / 100).toFixed(2));
    }
    for (let i = mine.length; i < perCategory; i++) {
      await block.locator('input[name="lineName"]').nth(i).fill('');
      await block.locator('input[name="lineAmount"]').nth(i).fill('');
    }
  }
  await page.getByTestId('wizard-continue').click();
  await expect(page).toHaveURL(/\/grants\/new\/5$/);

  // Step 5 — nothing in the books carries the grant yet, so there is nothing to propose; the
  // rules come with the report import. Finish.
  await expect(page.getByTestId('rules-empty')).toBeVisible();
  await page.getByTestId('wizard-continue').click();
  await page.waitForURL(/\/grants\/[a-z0-9]+\/todo\?saved=1$/);
  const created = await prisma.grant.findFirstOrThrow({
    where: { orgId, name: seed.name },
    include: { budgetLines: { orderBy: { sortOrder: 'asc' } } },
  });
  expect(created.awardAmountCents).toBe(seed.awardCents);
  expect(created.funder).toBe(seed.funder);
  expect(created.qboClassName).toBe(seed.scope.classPath);
  expect(created.memberClassIds).toEqual([]);
  expect(
    created.budgetLines
      .filter((l) => l.kind === 'funder_category')
      .map((l) => [l.code, l.budgetCents]),
  ).toEqual(seed.categories.map((c) => [c.code, c.budgetCents]));
  const byId = new Map(created.budgetLines.map((l) => [l.id, l.code]));
  expect(
    created.budgetLines
      .filter((l) => l.kind === 'working_line')
      .map((l) => [l.code, byId.get(l.parentId!), l.budgetCents]),
  ).toEqual(seed.lines.map((l) => [l.code, l.parent, l.budgetCents]));

  // seed:pilot finds the grant by name and only adds what the wizard cannot: the report import,
  // the eight rules and the 1,400 revision. Its figures must be the seeded golden figures.
  await seedPilot();
  expect(salahId).toBe(created.id);
  await page.goto(`/grants/${salahId}`);
  await cents(page.getByTestId('metric-spent'), SALAH_SPENT_SEEDED);
  await cents(page.getByTestId('tie-charged'), SALAH_SPENT_SEEDED);
  await expect(page.getByTestId('review-tab-count')).toHaveAttribute('data-count', '7');
  await page.goto(`/grants/${salahId}/todo`);
  await expect(page.getByTestId('todo-review')).toHaveAttribute('data-count', '7');
  await expectSalahBva(page, SALAH_LINES_SEEDED, SALAH_SPENT_SEEDED);
});
