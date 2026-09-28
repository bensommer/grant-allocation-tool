/**
 * JPH-29 · Phase E on the demo fixture: the three-tab grant workspace (AC1, AC14), one Budget
 * vs. Actuals page with a server-rendered view toggle (AC3, AC4), the single-page form kept
 * behind `?mode=form` (AC11), the setup wizard (AC10, AC12, AC13) and the vocabulary sweep
 * (AC15). The pilot-fixture criteria (AC2, AC5–AC9) live in jph29-phase-e-pilot.spec.ts.
 *
 * Runs in both the `chromium` and `chromium-nojs` projects; tests that create records run in
 * one project only.
 */
import { expect, test, type Page } from '@playwright/test';
import { prisma } from '../src/lib/db';
import { FORBIDDEN_TERMS } from '../src/copy/terms';
import { routes } from './routes';

const CULINARY = 'Culinary Workforce Grant';
const CULINARY_CLASS = 'Culinary Training';
const CULINARY_SPENT = 3_975_291;
const AS_OF = '2026-03-31';
/** Sub-routes the workspace had before Phase E; all still answer and stay two clicks away. */
const OLD_ROUTES = [
  'bva',
  'budget',
  'history',
  'narratives',
  'edit',
  'funder',
  'working',
  'activity',
  'review',
  'rules',
  'effort',
  'entries',
  'periods',
];
/** AC15 — words that must not appear on any grant workspace or wizard page. */
const PHASE_E_FORBIDDEN = [
  'BvA',
  'Working view',
  'Revenue matcher',
  'Grant membership —',
  'member line',
] as const;

let orgId: string;
let culinaryId: string;
const createdGrantNames: string[] = [];

test.beforeAll(async () => {
  const org = await prisma.org.findFirstOrThrow({ orderBy: { createdAt: 'asc' } });
  orgId = org.id;
  culinaryId = (await prisma.grant.findFirstOrThrow({ where: { orgId, name: CULINARY } })).id;
});

test.afterAll(async () => {
  if (createdGrantNames.length === 0) return;
  const grants = await prisma.grant.findMany({ where: { orgId, name: { in: createdGrantNames } } });
  const ids = grants.map((g) => g.id);
  await prisma.grantLineResult.deleteMany({ where: { grantId: { in: ids } } });
  await prisma.grant.deleteMany({ where: { id: { in: ids } } });
  await prisma.grantDraft.deleteMany({ where: { orgId, createdAt: { lt: new Date() } } });
});

const onlyProject = (name: string) =>
  test.skip(test.info().project.name !== name, `Runs in the ${name} project only`);

async function noHorizontalScroll(page: Page, label: string) {
  const dims = await page.evaluate(() => ({
    html: document.documentElement.scrollWidth,
    body: document.body.scrollWidth,
  }));
  expect(dims.html, `${label}: html`).toBeLessThanOrEqual(390);
  expect(dims.body, `${label}: body`).toBeLessThanOrEqual(390);
}

function assertVocabulary(html: string, route: string) {
  const text = html.replace(/<script[\s\S]*?<\/script>/g, '');
  for (const term of [...PHASE_E_FORBIDDEN, ...FORBIDDEN_TERMS])
    expect(text, `${route} contains "${term}"`).not.toContain(term);
}

// --- AC1 -------------------------------------------------------------------------------------

test('AC1: the workspace has exactly three tabs and every old sub-route is two clicks from one of them', async ({
  page,
}) => {
  const base = `/grants/${culinaryId}`;
  await page.goto(base);
  const tabs = page.getByTestId('grant-tabs').getByRole('link');
  await expect(tabs).toHaveCount(3);
  await expect(tabs).toHaveText(['Status', /^To do/, /^Setup/]);
  await expect(page.getByTestId('grant-tabs').getByText('Edit')).toHaveCount(0);

  // Click 1 = a tab; click 2 = any link on that tab's page. Status is the landing page.
  const reachable = new Set<string>();
  for (const tab of ['', '/todo', '/edit']) {
    await page.goto(`${base}${tab}`);
    const hrefs = await page
      .locator(`main a[href^="${base}"]`)
      .evaluateAll((as) => as.map((a) => (a as HTMLAnchorElement).getAttribute('href')!));
    for (const h of hrefs) reachable.add(h.replace(base, '').replace(/[?#].*$/, '') || '/');
    for (const h of hrefs) reachable.add(h.replace(base, ''));
  }
  const reachedVia = (route: string) => {
    if (route === 'funder') return [...reachable].some((h) => /^\/bva\?view=funder/.test(h));
    if (route === 'working') return [...reachable].some((h) => /^\/bva\?view=internal/.test(h));
    return reachable.has(`/${route}`);
  };
  for (const route of OLD_ROUTES) {
    const res = await page.request.get(`${base}/${route}`, { maxRedirects: 0 });
    if (route === 'funder' || route === 'working') {
      expect(res.status(), route).toBe(302);
      const target = res.headers()['location']!;
      expect(target).toContain(`/bva?view=${route === 'funder' ? 'funder' : 'internal'}`);
      expect((await page.request.get(target)).status(), target).toBe(200);
    } else expect(res.status(), route).toBe(200);
    expect(reachedVia(route), `${route} is not linked from a tab`).toBe(true);
  }
});

// --- AC3 / AC4 -------------------------------------------------------------------------------

test('AC3: the Funder / Internal toggle is plain links (works with JavaScript off) and export filenames carry the view', async ({
  page,
}) => {
  const base = `/grants/${culinaryId}/bva`;
  await page.goto(`${base}?asOf=${AS_OF}`);
  const toggle = page.getByTestId('bva-view-toggle');
  await expect(toggle).toHaveAttribute('data-view', 'funder');
  await toggle.getByTestId('bva-view-internal').click();
  await expect(page).toHaveURL(/\/bva\?.*view=internal/);
  await expect(page.getByTestId('bva-view-toggle')).toHaveAttribute('data-view', 'internal');
  await expect(page.locator('tr[data-testid="working-line"]').first()).toBeVisible();
  for (const kind of ['csv', 'xlsx', 'pdf']) {
    await expect(page.getByTestId(`bva-export-${kind}`)).toHaveAttribute('href', /view=internal/);
  }
  const csv = await page.request.get(
    (await page.getByTestId('bva-export-csv').getAttribute('href'))!,
  );
  expect(csv.headers()['content-disposition']).toMatch(/internal/);
  await toggle.getByTestId('bva-view-funder').click();
  await expect(page).toHaveURL(/view=funder/);
  const csvFunder = await page.request.get(
    (await page.getByTestId('bva-export-csv').getAttribute('href'))!,
  );
  expect(csvFunder.headers()['content-disposition']).toMatch(/funder/);
  expect(csvFunder.headers()['content-disposition']).not.toMatch(/internal/);
});

test('AC4: the Culinary grant (no funder categories) spends 3,975,291 under both views with no "Lines without a funder category" heading', async ({
  page,
}) => {
  for (const view of ['funder', 'internal']) {
    await page.goto(`/grants/${culinaryId}/bva?view=${view}&asOf=${AS_OF}`);
    await expect(page.getByTestId('bva-actual'), view).toHaveAttribute(
      'data-cents',
      String(CULINARY_SPENT),
    );
    await expect(
      page.getByTestId(view === 'funder' ? 'funder-charged' : 'total-charged'),
      view,
    ).toHaveAttribute('data-cents', String(CULINARY_SPENT));
    await expect(page.getByText('Lines without a funder category')).toHaveCount(0);
    // No funder categories: the same four lines are the table under both views.
    await expect(
      page.locator(`tr[data-testid="${view === 'funder' ? 'funder-line' : 'working-line'}"]`),
    ).toHaveCount(4);
  }
});

// --- AC11 ------------------------------------------------------------------------------------

test('AC11: /grants/new?mode=form still renders the single-page form; /grants/new starts the wizard', async ({
  page,
}) => {
  await page.goto('/grants/new?mode=form');
  await expect(page.getByRole('heading', { name: 'New grant' })).toBeVisible();
  await expect(page.locator('input[name="name"]')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Create grant' })).toBeVisible();
  await expect(page.getByTestId('wizard-progress')).toHaveCount(0);
  await page.goto('/grants/new');
  await expect(page).toHaveURL(/\/grants\/new\/1$/);
  await expect(page.getByTestId('wizard-step-1')).toBeVisible();
});

// --- Wizard: AC10, AC12, AC13, AC14 ----------------------------------------------------------

test('AC10 / AC12 / AC13 / AC14: the wizard keeps data across refresh and Back, resumes after "Save and finish later", counts the class, proposes rules by account and fits 390 px', async ({
  page,
}) => {
  onlyProject('chromium');
  test.setTimeout(180_000);
  const name = `Z Phase E wizard grant ${Date.now()}`; // "Z…" sorts after the demo grants so e2e/routes.ts never crawls it
  createdGrantNames.push(name);

  // Step 1 — refresh and Back keep what was typed (AC10).
  await page.goto('/grants/new');
  await expect(page).toHaveURL(/\/grants\/new\/1$/);
  await page.fill('#name', name);
  await page.fill('#funderText', 'Harbor Community Foundation');
  await page.fill('#awardNumber', 'PE-1');
  await page.fill('#awardAmount', '60,000.00');
  await page.fill('#startDate', '2026-01-01');
  await page.fill('#endDate', '2026-12-31');
  await page.getByTestId('wizard-continue').click();
  await expect(page).toHaveURL(/\/grants\/new\/2$/);
  await page.goBack();
  await expect(page).toHaveURL(/\/grants\/new\/1$/);
  await page.reload();
  await expect(page.locator('#name')).toHaveValue(name);
  await expect(page.locator('#awardAmount')).toHaveValue('60,000.00');
  await expect(page.getByTestId('wizard-progress')).toHaveAttribute('data-step', '1');

  // "Save and finish later" then /grants/new resumes at the saved step (AC10).
  await page.goto('/grants/new/2');
  await page.getByTestId('tracking-choice-class').check();
  await page.getByTestId('wizard-save').click();
  await expect(page).toHaveURL(/\/grants\?draft=1$/);
  await expect(page.getByTestId('draft-saved')).toBeVisible();
  await page.goto('/grants/new');
  await expect(page).toHaveURL(/\/grants\/new\/2$/);
  await expect(page.getByTestId('tracking-choice-class')).toBeChecked();

  // Step 2 — live count equals the fixture's count of transactions carrying the class (AC12).
  const cls = await prisma.trackingClass.findFirstOrThrow({
    where: { orgId, name: CULINARY_CLASS },
  });
  const expectedCount = await prisma.transactionLine.count({
    where: { orgId, classId: cls.id, deletedAt: null, transaction: { deletedAt: null } },
  });
  expect(expectedCount).toBeGreaterThan(0);
  await page.getByTestId('tracking-class').selectOption(cls.id);
  await page.getByTestId('tracking-recount').click();
  await expect(page).toHaveURL(/\/grants\/new\/2$/);
  await expect(page.getByTestId('tracking-count')).toHaveAttribute(
    'data-count',
    String(expectedCount),
  );
  await expect(page.getByTestId('tracking-count')).toContainText(
    `${expectedCount.toLocaleString('en-US')} transactions in the books carry this class`,
  );
  await page.getByTestId('wizard-continue').click();
  await expect(page).toHaveURL(/\/grants\/new\/3$/);

  // Step 3 — paste two columns; the chip compares the total with the award.
  await page.fill(
    '[data-testid="budget-paste"]',
    'Personnel\t40,000.00\nSupplies\t15,000.00\nTravel\t5,000.00',
  );
  await page.getByTestId('budget-paste-apply').click();
  await expect(page.locator('[data-testid="budget-row"] input[name="catName"]').nth(0)).toHaveValue(
    'Personnel',
  );
  await expect(page.getByTestId('budget-total-chip')).toHaveAttribute('data-cents', '6000000');
  await expect(page.getByTestId('budget-total-chip')).toHaveAttribute('data-difference-cents', '0');
  await page.getByTestId('wizard-continue').click();
  await expect(page).toHaveURL(/\/grants\/new\/4$/);

  // Step 4 — "Yes" shows the nested editor prefilled with one working line per category.
  await page.getByTestId('lines-yes').check();
  await page.getByTestId('wizard-continue').click();
  await expect(page).toHaveURL(/\/grants\/new\/4$/);
  await expect(page.getByTestId('lines-category')).toHaveCount(3);
  const personnel = page.locator('[data-testid="lines-category"][data-code="PERSONNEL"]');
  await expect(personnel.locator('input[name="lineName"]').first()).toHaveValue('Personnel');
  await personnel.locator('input[name="lineName"]').nth(0).fill('Director');
  await personnel.locator('input[name="lineAmount"]').nth(0).fill('25,000');
  await personnel.locator('input[name="lineName"]').nth(1).fill('Coordinator');
  await personnel.locator('input[name="lineAmount"]').nth(1).fill('15,000');
  await page.getByTestId('wizard-continue').click();
  await expect(page).toHaveURL(/\/grants\/new\/5$/);

  // Step 5 — one row per expense account with a nonzero total, sorted by amount desc; a new
  // grant has no rules, so the engine never reaches confidence 'account' and nothing is
  // pre-selected (AC13).
  const expected = await prisma.transactionLine.groupBy({
    by: ['accountId'],
    where: {
      orgId,
      classId: cls.id,
      deletedAt: null,
      transaction: { deletedAt: null },
      account: { type: { in: ['Expense', 'COGS', 'OtherExpense'] } },
    },
    _sum: { amountCents: true },
  });
  const expectedAccounts = expected
    .filter((r) => (r._sum.amountCents ?? 0) !== 0)
    .sort((a, b) => Math.abs(b._sum.amountCents ?? 0) - Math.abs(a._sum.amountCents ?? 0));
  const accountRows = page.locator('tr[data-testid="rule-account-row"]');
  await expect(accountRows).toHaveCount(expectedAccounts.length);
  const ids = await accountRows.evaluateAll((trs) =>
    trs.map((t) => t.getAttribute('data-account')),
  );
  expect(ids).toEqual(expectedAccounts.map((r) => r.accountId));
  const totals = (await accountRows.evaluateAll((trs) =>
    trs.map((t) => Number(t.getAttribute('data-cents'))),
  )) as number[];
  expect(totals).toEqual(expectedAccounts.map((r) => r._sum.amountCents));
  for (const t of totals) expect(t).not.toBe(0);
  await expect(page.locator('tr[data-preselected="true"]')).toHaveCount(0);
  for (const sel of await page.locator('[data-testid="rules-rows"] select').all())
    await expect(sel).toHaveValue('later');
  // Accept the largest account into Director; leave the rest for later.
  await accountRows.first().locator('select').selectOption({ label: 'Director' });

  // Every step renders without horizontal scroll at 390 px (AC14).
  await page.setViewportSize({ width: 390, height: 844 });
  for (const n of [1, 2, 3, 4, 5]) {
    await page.goto(`/grants/new/${n}`);
    await expect(page.getByTestId(`wizard-step-${n}`)).toBeVisible();
    await noHorizontalScroll(page, `wizard step ${n}`);
    const html = await page.content();
    assertVocabulary(html, `/grants/new/${n}`);
  }
  await page.setViewportSize({ width: 1280, height: 900 });

  // Finish → the grant exists with its categories, lines and the one accepted rule; land on To do.
  await page.goto('/grants/new/5');
  await accountRows.first().locator('select').selectOption({ label: 'Director' });
  await page.getByTestId('wizard-continue').click();
  await page.waitForURL(/\/grants\/[a-z0-9]+\/todo\?saved=1$/);
  const grant = await prisma.grant.findFirstOrThrow({
    where: { orgId, name },
    include: { budgetLines: { orderBy: { sortOrder: 'asc' } }, grantRules: true },
  });
  expect(grant.memberClassIds).toEqual([cls.id]);
  expect(grant.awardAmountCents).toBe(6_000_000);
  expect(
    grant.budgetLines
      .filter((l) => l.kind === 'funder_category')
      .map((l) => [l.code, l.budgetCents]),
  ).toEqual([
    ['PERSONNEL', 4_000_000],
    ['SUPPLIES', 1_500_000],
    ['TRAVEL', 500_000],
  ]);
  expect(
    grant.budgetLines.filter((l) => l.kind === 'working_line').map((l) => [l.name, l.budgetCents]),
  ).toEqual([
    ['Director', 2_500_000],
    ['Coordinator', 1_500_000],
    ['Supplies', 1_500_000],
    ['Travel', 500_000],
  ]);
  expect(grant.grantRules).toHaveLength(1);
  expect((grant.grantRules[0]!.matchers as { accountIds: string[] }).accountIds).toEqual([
    expectedAccounts[0]!.accountId,
  ]);
  // The cookie is gone: /grants/new starts a fresh wizard.
  await page.goto('/grants/new');
  await expect(page).toHaveURL(/\/grants\/new\/1$/);
  await expect(page.locator('#name')).toHaveValue('');
});

// --- AC14 / AC15 on the workspace -----------------------------------------------------------

test('AC14: the three tabs render without horizontal scroll at 390 px', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  for (const tab of ['', '/todo', '/edit', '/bva?view=internal', '/bva?view=funder&mode=months']) {
    await page.goto(`/grants/${culinaryId}${tab}`);
    await noHorizontalScroll(page, tab || '/');
  }
});

test('AC15: "BvA", "Working view", "Revenue matcher", "Grant membership —" and "member line" appear on no grant workspace or wizard page', async ({
  page,
}) => {
  const grantRoutes = (await routes()).filter((r) => r.startsWith('/grants/'));
  expect(grantRoutes.length).toBeGreaterThan(10);
  for (const route of [...grantRoutes, '/grants/new?mode=form']) {
    const res = await page.request.get(route);
    expect(res.status(), route).toBe(200);
    assertVocabulary(await res.text(), route);
  }
});
