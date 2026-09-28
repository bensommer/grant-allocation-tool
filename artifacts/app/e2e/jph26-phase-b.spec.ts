/**
 * JPH-26 Phase B — the rule builder in the browser, on the demo (JPH-7) fixture.
 * Runs in both the `chromium` and `chromium-nojs` projects unless a case needs to drive its own
 * JS/no-JS contexts. Pilot cases (AC3, AC6b) live in pilot.spec.ts, which seeds the pilot data.
 */
import { expect, test, type Page } from '@playwright/test';
import { prisma } from '../src/lib/db';

const PREFIX = 'Z JPH-26 ';
let ym = '';
let ct = '';
let rent = '';
let salaries = '';
let payrollTaxes = '';
let grantId = '';

test.beforeAll(async () => {
  const org = await prisma.org.findFirstOrThrow({ orderBy: { createdAt: 'asc' } });
  const program = (code: string) =>
    prisma.program.findFirstOrThrow({ where: { orgId: org.id, code }, select: { id: true } });
  const account = (number: string) =>
    prisma.account.findFirstOrThrow({ where: { orgId: org.id, number }, select: { id: true } });
  ym = (await program('YM')).id;
  ct = (await program('CT')).id;
  rent = (await account('6210')).id;
  salaries = (await account('6010')).id;
  payrollTaxes = (await account('6020')).id;
  grantId = (
    await prisma.grant.findFirstOrThrow({
      where: { orgId: org.id, name: 'Youth Meals Grant' },
      select: { id: true },
    })
  ).id;
});

test.afterEach(async () => {
  await prisma.crosswalkRule.deleteMany({ where: { name: { startsWith: PREFIX } } });
});

const FORBIDDEN = ['Payees / parties', 'matcher', 'member line', 'Preview from'];

async function bodyText(page: Page) {
  return page.evaluate(() => document.body.innerText);
}

/** Build the same rule on /crosswalk/new: target = first budget line, program YM, account Rent. */
async function buildRule(page: Page, name: string, js: boolean) {
  await page.goto(`/crosswalk/new`);
  if (js)
    await expect(page.getByTestId('crosswalk-rule-form')).toHaveAttribute('data-hydrated', 'true');
  await page.locator('select[name="grantBudgetLineId"]').selectOption({ index: 1 });
  // With JS the disclosure is a menu that adds one row per pick; without JS it holds the rows.
  if (js) {
    for (const label of ['Program', 'Description contains all of']) {
      await page.getByText('Add condition').click();
      await page.getByRole('menuitem', { name: label }).click();
    }
  } else {
    await page.getByText('Add condition').click();
  }
  await page.locator(`input[name="programIds"][value="${ym}"]`).check();
  await page.locator(`input[name="accountIds"][value="${rent}"]`).check();
  await page.fill('input[name="descriptionContains"]', 'rent');
  await page.fill('input[name="name"]', name);
}

test('AC2: with JS disabled, Preview shows a match count and Save stores the same matchers JSON as the JS builder', async ({
  browser,
}) => {
  test.skip(test.info().project.name !== 'chromium', 'Drives its own JS and no-JS contexts');
  const jsName = `${PREFIX}js ${Date.now()}`;
  const noJsName = `${PREFIX}nojs ${Date.now()}`;

  // No-JS first: the JS twin would otherwise win the same lines at the same priority.
  const noJs = await browser.newContext({ javaScriptEnabled: false });
  const page = await noJs.newPage();
  await buildRule(page, noJsName, false);
  await page.getByRole('button', { name: 'Preview', exact: true }).click();
  await page.waitForURL(/preview=1/);
  await expect(page.getByTestId('preview-count')).toHaveText('3');
  await expect(page.getByTestId('rule-match-count')).toHaveText('3 transactions');
  // The bounce kept every field, so Save persists exactly what was previewed.
  await expect(page.locator(`input[name="programIds"][value="${ym}"]`)).toBeChecked();
  await expect(page.locator('input[name="descriptionContains"]')).toHaveValue('rent');
  await page.getByRole('button', { name: 'Create rule' }).click();
  await page.waitForURL(/\/crosswalk\/[a-z0-9]+\?saved=1/);
  await noJs.close();

  const withJs = await browser.newContext({ javaScriptEnabled: true });
  const jsPage = await withJs.newPage();
  await buildRule(jsPage, jsName, true);
  await jsPage.getByRole('button', { name: 'Create rule' }).click();
  await jsPage.waitForURL(/\/crosswalk\/[a-z0-9]+\?saved=1/);
  await withJs.close();

  const [a, b] = await Promise.all([
    prisma.crosswalkRule.findFirstOrThrow({ where: { name: jsName } }),
    prisma.crosswalkRule.findFirstOrThrow({ where: { name: noJsName } }),
  ]);
  expect(JSON.stringify(b.matchers)).toBe(JSON.stringify(a.matchers));
  expect(a.priority).toBe(50);
  expect(b.priority).toBe(50);
});

test('AC4: a new rule saves with priority 50 untouched; a seed rule opens with its stored 10 and keeps it on save', async ({
  page,
}) => {
  await page.goto('/crosswalk/new');
  await expect(page.locator('input[name="priority"]')).toHaveValue('50');
  await expect(page.getByTestId('advanced')).toContainText(
    'When two rules match the same transaction, the lower number wins. New rules default to 50; seed rules use 10.',
  );
  const seed = await prisma.crosswalkRule.findFirstOrThrow({ where: { name: 'G-MWSC/PERS' } });
  expect(seed.priority).toBe(10);
  await page.goto(`/crosswalk/${seed.id}`);
  await expect(page.locator('input[name="priority"]')).toHaveValue('10');
  await page.getByRole('button', { name: 'Save changes' }).click();
  await page.waitForURL(/saved=1/);
  const after = await prisma.crosswalkRule.findUniqueOrThrow({ where: { id: seed.id } });
  expect(after.priority).toBe(10);
  expect(after.matchers).toEqual(seed.matchers);
});

test('AC5: superset warning for a rule matching everything G-MWSC/PERS matches, none for a disjoint rule', async ({
  page,
}) => {
  await page.goto(`/crosswalk/new?programId=${ct}&accountId=${salaries}`);
  await page.locator(`input[name="accountIds"][value="${payrollTaxes}"]`).check();
  await page.getByRole('button', { name: 'Preview', exact: true }).click();
  await page.waitForURL(/preview=1/);
  await expect(page.getByTestId('superset-warning')).toHaveText(
    'This rule matches everything rule G-MWSC/PERS (priority 10) matches; it will never win.',
  );

  await page.goto(`/crosswalk/new?programId=${ym}&accountId=${rent}`);
  await expect(page.getByTestId('rule-preview')).toBeVisible();
  await expect(page.getByTestId('superset-warning')).toHaveCount(0);
});

test('AC6: /crosswalk/new?programId=<YM>&accountId=<6210> pre-adds both conditions and previews 3 transactions · $1,800.00', async ({
  page,
}) => {
  await page.goto(`/crosswalk/new?programId=${ym}&accountId=${rent}`);
  await expect(page.locator(`input[name="programIds"][value="${ym}"]`)).toBeChecked();
  await expect(page.locator(`input[name="accountIds"][value="${rent}"]`)).toBeChecked();
  await expect(page.locator('input[type="checkbox"][name$="Ids"]:checked')).toHaveCount(2);
  await expect(page.getByTestId('rule-sentence')).toHaveText(
    'All transactions where program is Youth Meals AND account is Rent → (choose a target)',
  );
  await expect(page.getByTestId('preview-summary')).toContainText(
    'Matches 3 transactions · $1,800.00 in ',
  );
  await expect(page.getByTestId('preview-summary').locator('[data-cents]')).toHaveAttribute(
    'data-cents',
    '180000',
  );
  await expect(page.getByTestId('rule-preview').locator('tbody tr')).toHaveCount(3);
});

test('AC7: "Rule decides" only on grant rules; "Program" condition only on crosswalk rules', async ({
  page,
}) => {
  await page.goto('/crosswalk/new');
  await expect(page.getByRole('radiogroup', { name: 'Rule decides' })).toHaveCount(0);
  await page.getByText('Add condition').click();
  await expect(page.getByText('Program', { exact: true }).first()).toBeVisible();

  await page.goto(`/grants/${grantId}/rules/new`);
  const decides = page.getByRole('radiogroup', { name: 'Rule decides' });
  await expect(decides).toBeVisible();
  await expect(decides.getByText('Working line')).toBeVisible();
  await expect(decides.getByText('Activity')).toBeVisible();
  await expect(decides.getByText('Category')).toBeVisible();
  await page.getByText('Add condition').click();
  await expect(page.getByText('Program', { exact: true })).toHaveCount(0);
  await expect(page.locator('input[name="programIds"]')).toHaveCount(0);
});

test('AC9: both builders render without horizontal scroll at 390 px', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  for (const path of ['/crosswalk/new', `/grants/${grantId}/rules/new`]) {
    await page.goto(path);
    await page.getByText('Add condition').click();
    const widths = await page.evaluate(() => ({
      scroll: document.documentElement.scrollWidth,
      client: document.documentElement.clientWidth,
    }));
    expect(widths.scroll, path).toBeLessThanOrEqual(widths.client);
    await expect(page.getByTestId('rule-sentence')).toBeVisible();
  }
});

test('AC10: no "Payees / parties", "matcher", "member line" or "Preview from" on either builder route', async ({
  page,
}) => {
  const seed = await prisma.crosswalkRule.findFirstOrThrow({ where: { name: 'G-MWSC/PERS' } });
  for (const path of [
    '/crosswalk/new',
    `/crosswalk/${seed.id}`,
    `/grants/${grantId}/rules/new`,
    `/crosswalk/new?programId=${ym}&accountId=${rent}`,
  ]) {
    await page.goto(path);
    await page.getByText('Add condition').click();
    const text = await bodyText(page);
    for (const word of FORBIDDEN)
      expect(text.toLowerCase(), `${path} shows "${word}"`).not.toContain(word.toLowerCase());
    await expect(page.locator('input[name="previewFrom"], input[name="previewTo"]')).toHaveCount(0);
  }
});

test.describe('with JavaScript', () => {
  test.skip(({ javaScriptEnabled }) => !javaScriptEnabled, 'The island needs JS');

  test('sentence, name and live preview follow the conditions; chips remove them', async ({
    page,
  }) => {
    await page.goto('/crosswalk/new');
    await expect(page.getByTestId('crosswalk-rule-form')).toHaveAttribute('data-hydrated', 'true');
    await expect(page.getByTestId('rule-sentence')).toHaveText(
      'All transactions → (choose a target)',
    );
    await page.locator(`input[name="accountIds"][value="${rent}"]`).check();
    await expect(page.getByTestId('rule-sentence')).toHaveText(
      'All transactions where account is Rent → (choose a target)',
    );
    await expect(page.locator('input[name="name"]')).toHaveValue(
      'All transactions where account is Rent',
    );
    await page.getByText('Add condition').click();
    await page.getByRole('menuitem', { name: 'Program' }).click();
    await page.locator(`input[name="programIds"][value="${ym}"]`).check();
    await expect(page.getByTestId('rule-sentence')).toHaveText(
      'All transactions where program is Youth Meals AND account is Rent → (choose a target)',
    );
    await expect(page.getByTestId('preview-count')).toHaveText('3');
    await expect(page.getByTestId('rule-match-count')).toHaveText('3 transactions');
    // Chips mirror the checkboxes; removing one clears the condition and the preview follows.
    await expect(page.getByTestId('chip')).toHaveCount(2);
    await page.getByTestId('chip').filter({ hasText: 'Rent 6210' }).getByRole('button').click();
    await expect(page.locator(`input[name="accountIds"][value="${rent}"]`)).not.toBeChecked();
    await expect(page.getByTestId('rule-sentence')).toHaveText(
      'All transactions where program is Youth Meals → (choose a target)',
    );
  });

  test('selections made before or outside an active search stay in the preview and the saved rule', async ({
    page,
  }) => {
    const name = `${PREFIX}search ${Date.now()}`;
    await page.goto('/crosswalk/new');
    await expect(page.getByTestId('crosswalk-rule-form')).toHaveAttribute('data-hydrated', 'true');
    await page.locator('select[name="grantBudgetLineId"]').selectOption({ index: 1 });
    await page.locator(`input[name="accountIds"][value="${rent}"]`).check();
    // Search hides Rent from the list; the selection must survive.
    await page.getByLabel('Search accountIds').fill('salar');
    await expect(page.locator(`input[name="accountIds"][value="${payrollTaxes}"]`)).toBeHidden();
    await page.locator(`input[name="accountIds"][value="${salaries}"]`).check();
    await expect(page.getByTestId('chip')).toHaveCount(2);
    await expect(page.getByTestId('rule-sentence')).toContainText(
      'account is Rent or Salaries & Wages',
    );
    // Live preview (POST /api/rules/preview from new FormData(form)) sees both accounts.
    await expect(page.getByTestId('preview-count')).not.toHaveText('0');
    const previewed = Number(await page.getByTestId('preview-count').textContent());
    await page.getByLabel('Search accountIds').fill('zzz');
    await expect(page.getByText('No matches.')).toHaveCount(0); // selected options stay listed
    await page.getByLabel('Search accountIds').fill('salar');
    await page.fill('input[name="name"]', name);
    // Save while the search is still active.
    await page.getByRole('button', { name: 'Create rule' }).click();
    await page.waitForURL(/\/crosswalk\/[a-z0-9]+\?saved=1/);
    const saved = await prisma.crosswalkRule.findFirstOrThrow({ where: { name } });
    expect([...(saved.matchers as { accountIds: string[] }).accountIds].sort()).toEqual(
      [rent, salaries].sort(),
    );
    // The edit page previews the same count the builder showed.
    await page.getByRole('button', { name: 'Preview', exact: true }).click();
    await page.waitForURL(/preview=1/);
    await expect(page.getByTestId('preview-count')).toHaveText(String(previewed));
  });

  test('accounts list shows expense accounts by default with a "Show all accounts" toggle', async ({
    page,
  }) => {
    await page.goto('/crosswalk/new');
    await expect(page.getByTestId('crosswalk-rule-form')).toHaveAttribute('data-hydrated', 'true');
    const checking = page
      .locator('[data-group="accountIds"] .chip-option')
      .filter({ hasText: /Operating Checking/ });
    await expect(
      page.locator('[data-group="accountIds"] .chip-option[data-dim]').first(),
    ).toBeHidden();
    await expect(checking.first()).toBeHidden();
    await page.getByTestId('show-all-accounts').check();
    await expect(checking.first()).toBeVisible();
  });
});
