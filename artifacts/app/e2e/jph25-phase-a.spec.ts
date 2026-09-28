import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test, type Page } from '@playwright/test';
import { CsvDataSource } from '@/datasource/csv/adapter';
import { FULL_RANGE, runImport } from '@/datasource/import-service';
import { getOrgId } from '@/lib/org';
import { FORBIDDEN_TERMS, RUN_HASH_PATTERN } from '@/copy/terms';
import { routes } from './routes';

/**
 * JPH-25 Phase A — audit fixes, asserted on the JPH-7 demo fixture whose books run
 * through 2026-03-31. Every money assertion reads a rendered data-cents attribute.
 */
const AS_OF = '2026-03-31';
const DEFAULT_PERIOD = 'Jan 1 – Mar 31, 2026 · books through Mar 31, 2026';

const cents = (loc: ReturnType<Page['locator']>, value: number) =>
  expect(loc).toHaveAttribute('data-cents', String(value));

/** Delete a grant this spec created through the app's own delete / archive flow. */
async function removeGrant(page: Page, grantUrl: string) {
  await page.goto(`${grantUrl}/edit`);
  await page.getByRole('link', { name: 'Delete / archive grant…' }).click();
  await page.getByRole('button', { name: 'Delete / archive grant' }).click();
  await page.waitForURL(/\/grants\?deleted=1/);
}

async function subtitle(page: Page, path: string) {
  await page.goto(path);
  return (await page.getByTestId('period-subtitle').first().textContent())!
    .replace(/\s+/g, ' ')
    .trim();
}

test('AC2: with no params and no cookie every period page shows the same default period', async ({
  page,
}) => {
  const fixed = [
    '/',
    '/restricted',
    '/crosswalk/coverage',
    '/reports/custom',
    '/grants/rollforward',
  ];
  for (const path of fixed) expect(await subtitle(page, path), path).toBe(DEFAULT_PERIOD);
  await page.goto('/reports');
  const presets = await page
    .getByTestId('preset-link')
    .evaluateAll((links) => links.map((a) => (a as HTMLAnchorElement).getAttribute('href')!));
  expect(presets).toHaveLength(4);
  for (const href of presets) {
    expect(href, href).toContain(`from=2026-01-01&to=${AS_OF}`);
    expect(await subtitle(page, href), href).toBe(DEFAULT_PERIOD);
  }
});

test('AC3: applying an as-of on the dashboard carries to /restricted with no params', async ({
  page,
}) => {
  await page.goto('/?asOf=2026-02-28');
  await expect(page.getByTestId('period-subtitle')).toContainText('Jan 1 – Feb 28, 2026');
  await page.goto('/restricted');
  await expect(page.getByTestId('period-subtitle')).toContainText('Jan 1 – Feb 28, 2026');
  await expect(page.getByLabel('As of')).toHaveValue('2026-02-28');
});

const GOLD = {
  restrictedBalance: 2386589,
  culinarySpent: 3975291,
  unmappedProgramExpense: 216000,
  nonGrantExpense: 1382450,
} as const;

async function culinaryId(page: Page) {
  await page.goto('/grants');
  const href = await page
    .getByRole('link', { name: 'Culinary Workforce Grant', exact: true })
    .getAttribute('href');
  return href!.split('/').pop()!;
}

test('AC1: /restricted renders a tfoot total row whose Restricted balance equals the dashboard card', async ({
  page,
}) => {
  await page.goto(`/restricted?asOf=${AS_OF}`);
  const foot = page.locator('tfoot [data-testid="restricted-total-row"]');
  await expect(foot).toHaveCount(1);
  await cents(foot.getByTestId('restricted-total-balance'), GOLD.restrictedBalance);
  // JPH-28 D2: the dashboard cards live on /reports/overview.
  await page.goto(`/reports/overview?asOf=${AS_OF}`);
  await cents(page.getByTestId('restricted-total'), GOLD.restrictedBalance);
});

test('AC4: dashboard card, reconciliation check and coverage total agree on unmapped program expense; MG/FR rows are n/a', async ({
  page,
}) => {
  await page.goto(`/reports/overview?asOf=${AS_OF}`);
  await cents(page.getByTestId('unmapped-total'), GOLD.unmappedProgramExpense);
  await cents(page.getByTestId('check-unmapped_program_expense'), GOLD.unmappedProgramExpense);
  await expect(
    // JPH-28 D5: the health check is named "Program expense mapped to a grant".
    page.getByText(/Program expense mapped to a grant · \$2,160\.00 across \d+ transactions/),
  ).toBeVisible();
  await cents(page.getByTestId('non-grant-total'), GOLD.nonGrantExpense);
  await page.goto(`/crosswalk/coverage?from=2026-01-01&to=${AS_OF}`);
  const foot = page.locator('tfoot [data-testid="coverage-total-row"]');
  await cents(foot.getByTestId('coverage-total-unmapped'), GOLD.unmappedProgramExpense);
  await cents(
    page.locator('tfoot [data-testid="coverage-non-grant-expense"]'),
    GOLD.nonGrantExpense,
  );
  for (const code of ['MG', 'FR']) {
    const row = page.locator(`tr[data-testid="coverage-row"][data-program="${code}"]`);
    await expect(row.getByTestId('coverage-row-pct')).toHaveText('n/a — non-grant');
    await cents(row.getByTestId('coverage-row-unmapped'), 0);
  }
  await expect(
    page.locator(
      'tr[data-testid="coverage-row"][data-program="YM"] [data-testid="coverage-row-pct"]',
    ),
  ).toHaveText('90.8%');

  // An earlier as-of: the card, the check row and the coverage total (which inherits the
  // as-of through the cookie and defaultRange) must still be one number for one period.
  await page.goto('/reports/overview?asOf=2026-02-28');
  const febCard = await page.getByTestId('unmapped-total').getAttribute('data-cents');
  const febCheck = await page
    .getByTestId('check-unmapped_program_expense')
    .getAttribute('data-cents');
  expect(febCard).toMatch(/^\d+$/);
  expect(febCheck).toBe(febCard);
  expect(Number(febCard)).toBeLessThan(GOLD.unmappedProgramExpense);
  await expect(
    page.getByText(/Program expense mapped to a grant · \$[\d,]+\.\d{2} across/),
  ).toContainText('Jan 1 – Feb 28, 2026');
  await page.goto('/crosswalk/coverage');
  await expect(page.getByTestId('period-subtitle')).toContainText('Jan 1 – Feb 28, 2026');
  await expect(
    page.locator(
      'tfoot [data-testid="coverage-total-row"] [data-testid="coverage-total-unmapped"]',
    ),
  ).toHaveAttribute('data-cents', febCard!);
});

test('AC5: Coverage, Restricted, Funder and Working total rows are real tfoot cells', async ({
  page,
}) => {
  const id = await culinaryId(page);
  await page.goto(`/grants/${id}/funder?asOf=${AS_OF}`);
  await cents(page.locator('tfoot [data-testid="funder-charged"]'), GOLD.culinarySpent);
  await page.goto(`/grants/${id}/working?asOf=${AS_OF}`);
  await cents(page.locator('tfoot [data-testid="total-charged"]'), GOLD.culinarySpent);
  await page.goto(`/restricted?asOf=${AS_OF}`);
  await cents(page.locator('tfoot [data-testid="restricted-total-spent"]'), 6113411);
  await page.goto(`/crosswalk/coverage?from=2026-01-01&to=${AS_OF}`);
  await cents(page.locator('tfoot [data-testid="coverage-total-mapped"]'), 6113411);
  await expect(page.locator('tfoot [data-testid="coverage-total-pct"]')).toHaveText('96.6%');
});

test('AC6: breadcrumb audit over the crawl list — full trail on every route', async ({ page }) => {
  test.setTimeout(300_000); // crawls every route, like mobile.spec
  test.skip(test.info().project.name !== 'chromium', 'One project is enough for a copy audit');
  await page.setViewportSize({ width: 1280, height: 900 });
  const all = await routes();
  const grant = all.find((p) => /^\/grants\/[^/]+$/.test(p) && !p.startsWith('/grants/new'))!;
  const batch = all.find((p) => /^\/import\/[^/]+$/.test(p) && !p.includes('qbo-report'))!;
  const expected: Record<string, number> = {
    '/': 2,
    [`${grant}/bva`]: 3,
    [`${grant}/review`]: 3,
    [batch]: 4,
    '/crosswalk/coverage': 3,
  };
  const trails: Record<string, string> = {};
  for (const path of all) {
    await page.goto(path);
    const nav = page.locator('nav[aria-label="Breadcrumb"]');
    await expect(nav, path).toHaveCount(1);
    const crumbs = await nav.locator('[data-crumb]').allTextContents();
    expect(crumbs.length, `${path} has a trail`).toBeGreaterThanOrEqual(1);
    trails[path] = crumbs.map((c) => c.replace(/\s*›\s*/g, '').trim()).join(' › ');
    if (path in expected) expect(crumbs.length, `${path} → ${trails[path]}`).toBe(expected[path]);
  }
  expect(trails['/']).toBe('Overview › Close checklist');
  expect(trails['/crosswalk/coverage']).toBe('Setup › Crosswalk › Coverage');
  expect(trails[`${grant}/bva`]).toMatch(/^Grants › .+ › Budget vs\. Actuals$/);
  expect(trails[`${grant}/review`]).toMatch(/^Grants › .+ › Review$/);
  expect(trails[batch]).toMatch(
    /^Data › Activity log › Import › Batch [A-Z][a-z]{2} \d{1,2}, \d{4}$/,
  );
});

test('AC7: grant tab strips have no Edit tab; the Edit grant button opens /grants/[id]/edit', async ({
  page,
}) => {
  const id = await culinaryId(page);
  for (const path of [`/grants/${id}`, `/grants/${id}/bva`, `/grants/${id}/review`]) {
    await page.goto(path);
    const strip = page.getByRole('navigation', { name: 'Grant workspace' });
    await expect(strip, path).toBeVisible();
    await expect(strip.getByRole('link', { name: /^Edit/ }), path).toHaveCount(0);
    const button = page.locator('.page-header').getByRole('link', { name: 'Edit grant' });
    await expect(button, path).toHaveAttribute('href', `/grants/${id}/edit`);
  }
  await page.locator('.page-header').getByRole('link', { name: 'Edit grant' }).click();
  await expect(page).toHaveURL(new RegExp(`/grants/${id}/edit$`));
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Edit');
});

test('AC8: import batch banner — no changes vs. a batch with a changed transaction', async ({
  page,
}) => {
  test.skip(test.info().project.name !== 'chromium', 'Runs imports; one project is enough');
  const dir = path.dirname(fileURLToPath(import.meta.url));
  async function upload(folder: string) {
    const result = await runImport(
      await getOrgId(),
      new CsvDataSource({ dir: path.resolve(dir, `../fixtures/${folder}`) }),
      FULL_RANGE,
    );
    expect(result.status).toBe('succeeded');
    return result.batchId;
  }
  try {
    await upload('demo');
    const identical = await upload('demo');
    await page.goto(`/import/${identical}`);
    const banner = page.getByTestId('import-banner');
    await expect(banner).toContainText('Succeeded — 20 transactions (38 lines) imported.');
    await expect(banner).toContainText('No changes from the previous import.');
    await expect(banner.getByRole('link')).toHaveCount(0);
    // Duplicated inner headings are gone: one "Counts per entity", hashes behind Technical details.
    await expect(page.getByText('Counts per entity')).toHaveCount(1);
    await expect(page.getByText(/File hashes/)).toBeHidden();
    await expect(page.locator('details[data-testid="technical-details"] summary')).toHaveText(
      'Technical details',
    );
    const edited = await upload('demo-edited');
    await page.goto(`/import/${edited}`);
    const link = page.getByTestId('import-banner').getByRole('link', {
      name: 'View changed and deleted →',
    });
    await expect(link).toHaveAttribute('href', `/import/${edited}/changes`);
    await expect(page.getByTestId('no-changes')).toHaveCount(0);
  } finally {
    await upload('demo');
  }
});

test('AC9: coverage "Create rule" for Youth Meals / Rent opens /crosswalk/new with both pre-checked', async ({
  page,
}) => {
  await page.goto(`/crosswalk/coverage?from=2026-01-01&to=${AS_OF}`);
  const row = page.locator(
    'tr[data-testid="unmapped-account"][data-program="YM"][data-account="6210"]',
  );
  await cents(row.getByTestId('unmapped-amount'), 180000);
  await expect(row.getByTestId('unmapped-transactions')).toHaveText('3');
  await expect(row.getByRole('link', { name: 'Rent' })).toHaveAttribute(
    'href',
    /\/crosswalk\/lines\?/,
  );
  await row.getByTestId('create-rule').click();
  await expect(page).toHaveURL(/\/crosswalk\/new\?programId=[a-z0-9]+&accountId=[a-z0-9]+$/);
  await expect(page.getByRole('heading', { level: 1 })).toContainText('New crosswalk rule');
  // Only the two matchers are pre-checked (the rule's "Active" toggle is checked by default).
  const matcherChecked = page.locator(
    'input[type="checkbox"][name$="Ids"]:checked, input[type="checkbox"][name$="Ids[]"]:checked',
  );
  await expect(matcherChecked).toHaveCount(2);
  await expect(page.getByLabel('Youth Meals (YM)')).toBeChecked();
  await expect(page.getByLabel('Rent 6210')).toBeChecked();
  await expect(page.locator('input[name="programIds"]:checked')).toHaveCount(1);
  await expect(page.locator('input[name="accountIds"]:checked')).toHaveCount(1);
});

test('AC10: history renders "Award amount: old → new" and never leaks Cents: or orgId', async ({
  page,
}) => {
  test.skip(test.info().project.name !== 'chromium', 'Creates a grant; one project is enough');
  const name = `Z Phase A history grant ${Date.now()}`; // "Z…" sorts after the demo grants so e2e/routes.ts never crawls it
  await page.goto('/grants/new?mode=form');
  await page.fill('input[name="name"]', name);
  await page.fill('input[name="funderText"]', 'Harbor Community Foundation');
  // Starts after the books-through date so a zero-spend grant is not flagged "under pace"
  // on the dashboard while another Playwright project reads it.
  await page.fill('input[name="startDate"]', '2026-06-01');
  await page.fill('input[name="endDate"]', '2026-12-31');
  await page.fill('input[name="awardAmount"]', '100,000.00');
  await page.getByRole('button', { name: 'Create grant' }).click();
  await page.waitForURL(/\/grants\/[a-z0-9]+\?saved=1/);
  const url = page.url().split('?')[0]!;
  await page.goto(`${url}/edit`);
  await page.fill('input[name="awardAmount"]', '120000');
  await page.getByRole('button', { name: 'Save changes' }).click();
  await page.waitForURL(/\?saved=1/);
  await page.goto(`${url}/history`);
  const rows = page.locator('tbody tr');
  const change = rows
    .first()
    .locator('[data-testid="history-changes"] li[data-field="awardAmountCents"]');
  await expect(change).toContainText('Award amount: $100,000.00 → $120,000.00');
  // The create row lists the funder as "Funder: — → …".
  await expect(rows.last().locator('li[data-field="funder"]')).toContainText(
    'Funder: — → Harbor Community Foundation',
  );
  const visible = await page.locator('main tbody').innerText();
  expect(visible).not.toMatch(/Cents:/);
  expect(visible).not.toMatch(/orgId/);
  expect(visible).not.toMatch(/awardAmountCents/);
  // Raw JSON exists only behind a collapsed Technical details.
  const details = rows.first().locator('details');
  await expect(details.locator('summary')).toHaveText('Technical details');
  await expect(details.locator('pre')).toBeHidden();
  await details.locator('summary').click();
  await expect(details.locator('pre')).toContainText('awardAmountCents');

  // Leave the demo dashboard as we found it (a zero-spend grant would otherwise be flagged).
  await removeGrant(page, url);
});

test('AC11: budget lines — one save persists two edits, delete confirms, money shows 72,000.00 and posts cents', async ({
  page,
}) => {
  const name = `Z Phase A budget grant ${Date.now()}`;
  await page.goto('/grants/new?mode=form');
  await page.fill('input[name="name"]', name);
  await page.fill('input[name="funderText"]', 'Harbor Community Foundation');
  // Starts after the books-through date so a zero-spend grant is not flagged "under pace"
  // on the dashboard while another Playwright project reads it.
  await page.fill('input[name="startDate"]', '2026-06-01');
  await page.fill('input[name="endDate"]', '2026-12-31');
  await page.fill('input[name="awardAmount"]', '100,000.00');
  await page.getByRole('button', { name: 'Create grant' }).click();
  await page.waitForURL(/\/grants\/[a-z0-9]+\?saved=1/);
  const url = page.url().split('?')[0]!;

  await page.goto(`${url}/budget`);
  for (const [code, label, budget] of [
    ['A', 'Alpha', '72,000.00'],
    ['B', 'Beta', '18,000.00'],
  ]) {
    await page.fill('#new-line input[name="code"]', code!);
    await page.fill('input[name="name"][form="new-line"]', label!);
    await page.fill('input[name="budget"][form="new-line"]', budget!);
    await page.getByRole('button', { name: 'Add line' }).click();
    // The URL already matches ?saved=1 after the first add, so wait for the row itself.
    await expect(page.locator(`tr[data-line-code="${code}"]`)).toHaveCount(1);
    await expect(page.locator('#new-line input[name="code"]')).toHaveValue('');
  }
  const rows = page.locator('tr[data-line-id]');
  await expect(rows).toHaveCount(2);
  const a = page.locator('tr[data-line-code="A"]');
  const b = page.locator('tr[data-line-code="B"]');
  const aBudget = a.locator('input[name="budget"]');
  await expect(aBudget).toHaveValue('72,000.00');
  await expect(aBudget).toHaveAttribute('type', 'text');
  await expect(aBudget).toHaveAttribute('inputmode', 'decimal');
  // Per-row Save/Delete are gone: one sticky Save, icon delete, blank actions header.
  await expect(a.getByRole('button', { name: 'Save' })).toHaveCount(0);
  await expect(page.getByTestId('budget-tree').locator('thead th').last()).toHaveText('');
  await expect(page.getByTestId('save-lines')).toHaveText('Save changes');
  await expect(page.getByTestId('working-total')).toHaveAttribute('data-cents', '9000000');
  await expect(page.getByTestId('award-chip')).toHaveText('under award by 10,000.00');

  // Edit two rows, save once → both persist; the post carries integer cents (JS project).
  const withJs = await page.evaluate(() => !!(window as { __next_f?: unknown }).__next_f);
  await a.locator('input[name="name"]').fill('Alpha edited');
  await b.locator('input[name="budget"]').fill('28,000.00');
  if (withJs) {
    await expect(a).toHaveAttribute('data-dirty', '');
    await expect(b).toHaveAttribute('data-dirty', '');
    await expect(page.locator('[data-dirty-count]')).toHaveText('2 unsaved rows');
    await expect(page.getByTestId('working-total')).toHaveAttribute('data-cents', '10000000');
    await expect(page.getByTestId('award-chip')).toHaveText('matches award');
  }
  const posted = page.waitForRequest((r) => r.method() === 'POST' && r.url().includes('/budget'));
  await page.getByTestId('save-lines').click();
  const body = (await posted).postData() ?? '';
  await page.waitForURL(/\/budget\?saved=2/);
  if (withJs) {
    expect(body).toContain('7200000');
    expect(body).toContain('2800000');
  }
  await expect(page.locator('tr[data-line-code="A"] input[name="name"]')).toHaveValue(
    'Alpha edited',
  );
  await expect(page.locator('tr[data-line-code="B"] input[name="budget"]')).toHaveValue(
    '28,000.00',
  );
  await expect(page.getByTestId('working-total')).toHaveAttribute('data-cents', '10000000');
  await expect(page.getByTestId('award-chip')).toHaveText('matches award');

  // Delete requires a confirm step: the icon opens it, the row is still there until confirmed.
  await page.locator('tr[data-line-code="B"]').getByTestId('delete-line').click();
  await expect(page.getByTestId('delete-confirm')).toContainText('Delete budget line B');
  await expect(page.locator('tr[data-line-id]')).toHaveCount(2);
  await page.getByTestId('delete-confirm').getByRole('button', { name: 'Delete line' }).click();
  await page.waitForURL(/\/budget\?saved=1/);
  await expect(page.locator('tr[data-line-id]')).toHaveCount(1);
  await expect(page.locator('tr[data-line-code="B"]')).toHaveCount(0);

  // Leave the demo dashboard as we found it (a zero-spend grant would otherwise be flagged).
  await removeGrant(page, url);
});

test('AC12: /reports has no raw query input; Page break lives in the PDF control, not the filter bar', async ({
  page,
}) => {
  await page.goto('/reports');
  const rawInputs = await page
    .locator('input')
    .evaluateAll(
      (els) => els.filter((el) => (el as HTMLInputElement).value.startsWith('rows=')).length,
    );
  expect(rawInputs).toBe(0);
  await expect(page.getByRole('button', { name: 'Save current view' })).toHaveCount(0);
  await expect(page.getByText('Page break')).toHaveCount(0);

  await page.goto(`/reports/custom?rows=program&cols=glAccount&from=2026-01-01&to=${AS_OF}`);
  const filterBar = page.locator('form.filter-bar, form[action="/reports/custom"]').first();
  await expect(filterBar).toBeVisible();
  await expect(filterBar.getByText('Page break')).toHaveCount(0);
  const pdf = page.getByTestId('pdf-export');
  await expect(pdf.getByText('Page break')).toBeVisible();
  await expect(pdf.locator('select[name="page"]')).toBeVisible();
  await expect(pdf.getByRole('button', { name: 'PDF' })).toBeVisible();
  // Save current view exists only on the custom report.
  await expect(page.getByText('Save current view')).toHaveCount(1);
});

test('AC13: no engine vocabulary in the rendered HTML of any crawled route', async ({
  request,
}) => {
  // Visible text only: strip tags, scripts and styles so ids/attributes cannot mask a leak
  // nor trigger a false hit. Attribute values such as `run-<id>` links are still checked
  // separately for the "run <hash>" pattern.
  const textOf = (html: string) =>
    html
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<[^>]+>/g, ' ')
      .replace(/&nbsp;/g, ' ')
      .replace(/\s+/g, ' ');
  const offenders: string[] = [];
  for (const route of await routes()) {
    const res = await request.get(route);
    expect(res.ok(), route).toBe(true);
    const text = textOf(await res.text());
    // Terms the ticket writes capitalised are matched as written (so the imported file name
    // "parties.csv" under Technical details does not count); lowercase ones match any case.
    for (const term of FORBIDDEN_TERMS) {
      const hit =
        term === term.toLowerCase() ? text.toLowerCase().includes(term) : text.includes(term);
      if (hit) offenders.push(`${route}: "${term}"`);
    }
    if (RUN_HASH_PATTERN.test(text))
      offenders.push(`${route}: ${text.match(RUN_HASH_PATTERN)![0]}`);
  }
  expect(offenders).toEqual([]);
});
