import { expect, test, type Page } from '@playwright/test';

/**
 * JPH-30 Phase 0 — one set of grant figures, asserted page by page on the demo
 * fixture (JPH-7) at its books-through date, 2026-03-31. Every number is the
 * fixture's golden value in cents; every assertion reads a rendered data-cents.
 */
const CULINARY = 'Culinary Workforce Grant';
const YOUTH = 'Youth Meals Grant';
const AS_OF = '2026-03-31';

const GOLD = {
  culinary: {
    spent: 3975291,
    received: 6000000,
    balance: 2024709,
    remainingAward: 8024709,
    byLine: { PERS: 2648190, SUPP: 637100, CONT: 150000, OCC: 540001 },
    pace: /Over pace: 34\.4% ahead of straight-line/,
  },
  youth: { spent: 2138120, received: 2500000, balance: 361880, pace: /Over pace: 73\.4%/ },
  totalEnding: 2386589,
} as const;

async function grantIds(page: Page) {
  await page.goto('/grants');
  const href = async (name: string) =>
    (await page.getByRole('link', { name, exact: true }).getAttribute('href'))!;
  return {
    culinary: (await href(CULINARY)).split('/').pop()!,
    youth: (await href(YOUTH)).split('/').pop()!,
  };
}

const cents = (loc: ReturnType<Page['getByTestId']>, value: number) =>
  expect(loc).toHaveAttribute('data-cents', String(value));

test('AC1: the Culinary figures are identical on the grants list, the overview, BvA, funder, working, restricted, rollforward and the dashboard', async ({
  page,
}) => {
  const ids = await grantIds(page);
  const g = GOLD.culinary;

  // /grants
  await page.goto(`/grants?asOf=${AS_OF}`);
  const listRow = page.getByRole('row', { name: new RegExp(CULINARY) });
  await cents(listRow.getByTestId('grant-spent'), g.spent);
  await cents(listRow.getByTestId('grant-balance'), g.balance);

  // /grants/[id] header cards
  await page.goto(`/grants/${ids.culinary}?asOf=${AS_OF}`);
  await cents(page.getByTestId('metric-spent'), g.spent);
  await cents(page.getByTestId('metric-received'), g.received);
  await cents(page.getByTestId('metric-balance'), g.balance);
  await cents(page.getByTestId('metric-remaining'), g.remainingAward);
  await expect(page.getByTestId('tracking-badge')).toContainText('Tracked by crosswalk rules');
  await expect(page.getByTestId('tie-out-crosswalk')).toContainText(
    'Tracked by crosswalk rules — review queue does not apply.',
  );
  await cents(page.getByTestId('tie-charged'), g.spent);

  // /grants/[id]/bva
  await page.goto(`/grants/${ids.culinary}/bva?asOf=${AS_OF}`);
  await cents(page.getByTestId('bva-actual'), g.spent);
  await cents(page.getByTestId('bva-received'), g.received);
  await cents(page.getByTestId('bva-balance'), g.balance);

  // /grants/[id]/funder and /working charge the same spend
  await page.goto(`/grants/${ids.culinary}/funder?asOf=${AS_OF}`);
  await cents(page.getByTestId('funder-charged'), g.spent);
  await page.goto(`/grants/${ids.culinary}/working?asOf=${AS_OF}`);
  await cents(page.getByTestId('total-charged'), g.spent);

  // /restricted
  await page.goto(`/restricted?asOf=${AS_OF}`);
  const restrictedRow = page.getByRole('row', { name: new RegExp(CULINARY) });
  await cents(restrictedRow.getByTestId('restricted-received'), g.received);
  await cents(restrictedRow.getByTestId('restricted-spent'), g.spent);
  await cents(restrictedRow.getByTestId('restricted-balance'), g.balance);
  await cents(restrictedRow.getByTestId('restricted-remaining'), g.remainingAward);

  // /grants/rollforward (ending) — default range ends at books-through
  await page.goto('/grants/rollforward');
  const heads = await page.locator('thead th').allTextContents();
  const col = heads.findIndex((t) => t === CULINARY) - 1;
  expect(col).toBeGreaterThanOrEqual(0);
  await cents(
    page.locator('tr[data-testid="rf-ending"] td').nth(col).locator('[data-cents]').first(),
    g.balance,
  );

  // / — restricted balances total = Culinary + Youth Meals
  await page.goto(`/?asOf=${AS_OF}`);
  await cents(page.getByTestId('restricted-total'), g.balance + GOLD.youth.balance);
});

test('AC2: the overview pacing card and the grants-list chip render the same string for both demo grants; "Under pace: 100.0%" appears nowhere', async ({
  page,
}) => {
  const ids = await grantIds(page);
  await page.goto(`/grants?asOf=${AS_OF}`);
  const chip = (name: string) =>
    page.getByRole('row', { name: new RegExp(name) }).getByTestId('pace-status');
  await expect(chip(CULINARY)).toHaveText(GOLD.culinary.pace);
  await expect(chip(YOUTH)).toHaveText(GOLD.youth.pace);
  const culinaryChip = await chip(CULINARY).textContent();
  const youthChip = await chip(YOUTH).textContent();

  for (const [id, chipText] of [
    [ids.culinary, culinaryChip],
    [ids.youth, youthChip],
  ] as const) {
    await page.goto(`/grants/${id}?asOf=${AS_OF}`);
    const card = page.getByTestId('pacing-callout').getByTestId('pace-status');
    await expect(card).toHaveText(chipText!);
    await expect(page.locator('body')).not.toContainText('Under pace: 100.0%');
  }
  for (const path of ['/', '/grants', '/restricted', `/grants/${ids.culinary}/working`]) {
    await page.goto(`${path}?asOf=${AS_OF}`);
    await expect(page.locator('body')).not.toContainText('Under pace: 100.0%');
  }
});

test('AC3: the Culinary funder view charges 2,648,190 / 637,100 / 150,000 / 540,001 = 3,975,291 with no "Lines without a funder category" heading', async ({
  page,
}) => {
  const ids = await grantIds(page);
  await page.goto(`/grants/${ids.culinary}/funder?asOf=${AS_OF}`);
  for (const [code, charged] of Object.entries(GOLD.culinary.byLine)) {
    const row = page.locator(`tr[data-testid="funder-line"][data-code="${code}"]`);
    await cents(row.getByTestId('line-charged'), charged);
  }
  await cents(page.getByTestId('funder-charged'), GOLD.culinary.spent);
  await cents(page.getByTestId('funder-budget'), 12000000);
  await expect(page.getByText('Lines without a funder category')).toHaveCount(0);
});

test('AC4: rollforward with no params defaults to books-through, says so, and ties', async ({
  page,
}) => {
  await page.goto('/grants/rollforward');
  await expect(page.locator('input#from')).toHaveValue('2026-01-01');
  await expect(page.locator('input#to')).toHaveValue(AS_OF);
  await expect(page.getByTestId('rf-range')).toContainText(`books through ${AS_OF}`);
  const heads = await page.locator('thead th').allTextContents();
  const col = (name: string) => heads.findIndex((t) => t === name) - 1;
  const ending = (c: number) =>
    page.locator('tr[data-testid="rf-ending"] td').nth(c).locator('[data-cents]').first();
  const direct = (c: number) =>
    page.locator('tr[data-testid="rf-direct"] td').nth(c).locator('[data-cents]').first();
  await cents(direct(col(CULINARY)), GOLD.culinary.spent);
  await cents(direct(col(YOUTH)), GOLD.youth.spent);
  await cents(ending(col(CULINARY)), GOLD.culinary.balance);
  await cents(ending(col(YOUTH)), GOLD.youth.balance);
  await cents(
    page.locator('tr[data-testid="rf-ending"] td').last().locator('[data-cents]').first(),
    GOLD.totalEnding,
  );
  await cents(page.getByTestId('rf-check-total').locator('[data-cents]'), 0);
});

test('AC5: the review queue of a crosswalk grant explains itself instead of saying nothing is waiting', async ({
  page,
}) => {
  const ids = await grantIds(page);
  await page.goto(`/grants/${ids.culinary}/review`);
  const notice = page.getByTestId('crosswalk-notice');
  await expect(notice).toContainText(
    'This grant is tracked by crosswalk rules, so it has no QuickBooks member lines.',
  );
  await expect(notice.getByRole('link', { name: 'Edit grant' })).toHaveAttribute(
    'href',
    `/grants/${ids.culinary}/edit`,
  );
  await expect(page.getByTestId('queue-empty')).toHaveCount(0);
  await expect(page.locator('body')).not.toContainText(
    'Nothing waiting — every member line is assigned or excluded.',
  );
  for (const tab of ['rules', 'effort', 'entries', 'periods']) {
    await page.goto(`/grants/${ids.culinary}/${tab}`);
    await expect(page.getByTestId('crosswalk-notice')).toBeVisible();
  }
});

test('AC6 (demo): the grant header carries the tracking badge on every grant page', async ({
  page,
}) => {
  const ids = await grantIds(page);
  for (const tab of ['', '/bva', '/funder', '/working', '/review']) {
    await page.goto(`/grants/${ids.youth}${tab}`);
    const badge = page.getByTestId('tracking-badge');
    await expect(badge).toHaveAttribute('data-mode', 'crosswalk');
    await expect(badge).toContainText('Tracked by crosswalk rules');
  }
});
