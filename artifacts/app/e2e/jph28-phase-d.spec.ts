/**
 * JPH-28 · Phase D on the demo fixture (JPH-7, as-of 2026-03-31): automatic recalculation after
 * mutations (AC1), the failed-calculation blocker (AC2, rendering half — the lock/failure path
 * itself is tests/db/recompute-queue.test.ts), export and lock steps (AC6), the moved dashboard
 * (AC7), the sidebar and old routes (AC8) and the copy rules (AC9).
 *
 * Golden numbers (cents): restricted balances 2,386,589; unmapped program expense 216,000;
 * non-grant 1,382,450; 2 flagged grants.
 */
import { expect, test, type Page } from '@playwright/test';
import { prisma } from '../src/lib/db';
import { ROLLFORWARD_EXPORT_KIND } from '../src/services/close-status';

test.describe.configure({ mode: 'serial' });

const AS_OF = '2026-03-31';
const GOLD = { restrictedBalance: 2_386_589, unmappedProgramExpense: 216_000, nonGrantExpense: 1_382_450 };

let orgId: string;

test.beforeAll(async () => {
  orgId = (await prisma.org.findFirstOrThrow({ orderBy: { createdAt: 'asc' } })).id;
});

const chip = (page: Page) => page.locator('header.app-header').getByTestId('freshness-chip');

async function currentRun() {
  return prisma.computeRun.findFirstOrThrow({ where: { orgId, isCurrent: true } });
}

/** The page the action redirected to must already show the finished calculation. */
async function expectUpdatedJustNow(page: Page, before: { id: string }, cause: string) {
  await expect(chip(page)).toHaveText('Updated just now');
  await expect(chip(page)).toHaveAttribute('data-state', 'fresh');
  const run = await currentRun();
  expect(run.id).not.toBe(before.id);
  expect(run.trigger).toBe('auto');
  expect(run.cause).toContain(cause);
}

test('AC1: saving a crosswalk rule redirects to a page whose chip reads "Updated just now" (trigger auto, cause names the rule)', async ({
  page,
}) => {
  const before = await currentRun();
  await page.goto('/crosswalk/new');
  await page.fill('input[name="name"]', `Z Phase D crosswalk ${Date.now()}`);
  await page.locator('select[name="grantBudgetLineId"]').selectOption({ index: 1 });
  await page.getByText('Add condition').click();
  const programItem = page.getByRole('menuitem', { name: 'Program' });
  if (await programItem.isVisible()) await programItem.click();
  await page.locator('input[name="programIds"]').first().check();
  await page.getByRole('button', { name: 'Create rule' }).click();
  await page.waitForURL(/\/crosswalk\/[a-z0-9]+\?saved=1/);
  await expectUpdatedJustNow(page, before, 'crosswalk rule');
  // No "Recompute" button anywhere in the header.
  await expect(page.locator('header.app-header').getByRole('button')).toHaveCount(0);
});

test('AC1: saving a budget line redirects with "Updated just now" (cause names the budget line)', async ({
  page,
}) => {
  const grant = await prisma.grant.findFirstOrThrow({
    where: { orgId, status: { not: 'archived' } },
    orderBy: { name: 'asc' },
  });
  const before = await currentRun();
  await page.goto(`/grants/${grant.id}/budget`);
  await page.fill('#new-line input[name="code"]', `ZPD${Date.now().toString().slice(-5)}`);
  await page.fill('input[name="name"][form="new-line"]', 'Z Phase D line');
  await page.fill('input[name="budget"][form="new-line"]', '1');
  await page.getByRole('button', { name: 'Add line' }).click();
  await page.waitForURL(/\/budget\?saved=1/);
  await expectUpdatedJustNow(page, before, 'budget line');
  // Leave the fixture as found: the line is empty, so it can be removed (soft — no results reference it).
  await prisma.grantBudgetLine.deleteMany({ where: { grantId: grant.id, name: 'Z Phase D line' } });
});

test('AC2: a failed calculation newer than the current one shows "Update failed — see activity log" and a red blocker linking to it; the previous run stays current', async ({
  page,
}) => {
  const before = await currentRun();
  // The failure path (invariant violation → failed row, previous run stays current) is proven
  // in tests/db/recompute-queue.test.ts; here a failed calculation is recorded the way that
  // path records it, and the pages must react to it.
  const failed = await prisma.computeRun.create({
    data: {
      orgId,
      configHash: before.configHash,
      status: 'failed',
      isCurrent: false,
      trigger: 'auto',
      cause: 'crosswalk rule saved (Z Phase D)',
      startedAt: new Date(),
      finishedAt: new Date(),
      checks: [{ name: 'trial_balance', ok: false, detail: 'simulated invariant failure' }],
      warnings: [],
    },
  });
  try {
    await page.goto(`/?asOf=${AS_OF}`);
    await expect(chip(page)).toHaveText('Update failed — see activity log');
    await expect(chip(page)).toHaveAttribute('data-state', 'failed');
    await expect(chip(page)).toHaveAttribute('href', '/activity');
    const blocker = page.getByTestId('failed-calculation-blocker');
    await expect(blocker).toBeVisible();
    await expect(blocker.getByRole('link')).toHaveAttribute('href', `/runs/${failed.id}`);
    // A period is never "closed" on numbers a failed calculation could not refresh.
    await expect(page.getByTestId('closed-banner')).toHaveCount(0);
    expect((await currentRun()).id).toBe(before.id);
    // The numbers below the blocker are still the previous calculation's.
    await expect(page.getByTestId('restricted-total')).toHaveAttribute(
      'data-cents',
      String(GOLD.restrictedBalance),
    );
    await page.goto('/activity');
    const row = page.locator(`tr[data-kind="calculation"][data-id="${failed.id}"]`);
    await expect(row).toHaveCount(1);
    await expect(row).toContainText('Failed');
  } finally {
    await prisma.computeRun.delete({ where: { id: failed.id } });
  }
});

test('AC2: a failed health check on the current calculation makes step 3 a red blocker; no "Closed through" banner', async ({
  page,
}) => {
  const current = await currentRun();
  const checks = current.checks as Array<{ name: string; status?: string; ok: boolean }>;
  // Record the trial-balance check as failing on the current calculation (restored below).
  await prisma.computeRun.update({
    where: { id: current.id },
    data: {
      checks: checks.map((c) => (c.name === 'trial_balance' ? { ...c, status: 'fail', ok: false } : c)),
    },
  });
  try {
    await page.goto(`/?asOf=${AS_OF}`);
    const step3 = page.locator('[data-step="budgets"]');
    await expect(step3).toHaveAttribute('data-tone', 'red');
    await expect(step3).toHaveAttribute('data-expanded', 'true');
    await expect(step3.getByTestId('step-budgets-badge')).toContainText('1 fail');
    await expect(step3.getByTestId('step-budgets-status')).toContainText(
      '1 health check fails: Trial balance provided',
    );
    await expect(page.getByTestId('closed-banner')).toHaveCount(0);
    // The health-checks card in the step's detail shows the same check as failing.
    await expect(step3.locator('li[data-check="trial_balance"]')).toHaveAttribute('data-status', 'fail');
  } finally {
    await prisma.computeRun.update({ where: { id: current.id }, data: { checks } });
  }
});

test('AC6: step 6 is amber until the rollforward XLSX is exported for the period, step 7 amber until a period lock exists', async ({
  page,
  request,
}) => {
  await prisma.export.deleteMany({ where: { orgId, kind: ROLLFORWARD_EXPORT_KIND } });
  await page.goto(`/?asOf=${AS_OF}`);
  const step6 = page.locator('[data-step="export"]');
  const step7 = page.locator('[data-step="lock"]');
  await expect(step6).toHaveAttribute('data-tone', 'amber');
  await expect(step6.getByTestId('step-export-button')).toHaveAttribute('href', '/grants/rollforward');
  await expect(step7).toHaveAttribute('data-tone', 'amber');
  await expect(step7.getByTestId('step-lock-badge')).toHaveText('Not locked');

  // An export for a period that does not contain the as-of does not count.
  const other = await request.get('/grants/rollforward/xlsx?from=2026-04-01&to=2026-06-30');
  expect(other.status()).toBe(200);
  await page.goto(`/?asOf=${AS_OF}`);
  await expect(step6).toHaveAttribute('data-tone', 'amber');

  const res = await request.get('/grants/rollforward/xlsx?from=2026-01-01&to=2026-03-31');
  expect(res.status()).toBe(200);
  expect(res.headers()['content-type']).toContain('spreadsheetml');
  await page.goto(`/?asOf=${AS_OF}`);
  await expect(step6).toHaveAttribute('data-tone', 'green');
  await expect(step6.getByTestId('step-export-badge')).toHaveText('Exported');
  // An as-of inside an exported period (Jan–Mar, Apr–Jun) is green; one outside both is amber.
  await page.goto('/?asOf=2026-02-28');
  await expect(step6).toHaveAttribute('data-tone', 'green');
  await page.goto('/?asOf=2026-07-31');
  await expect(step6).toHaveAttribute('data-tone', 'amber');

  const seededAt = new Date();
  await page.goto('/settings/periods');
  await page.fill('input[name="name"]', 'Z Phase D Q1');
  await page.fill('input[name="from"]', '2026-01-01');
  await page.fill('input[name="to"]', AS_OF);
  await page.getByRole('button', { name: 'Lock period' }).click();
  await page.waitForURL(/\/settings\/periods\?saved=1/);
  try {
    await page.goto(`/?asOf=${AS_OF}`);
    await expect(step7).toHaveAttribute('data-tone', 'green');
    await expect(step7.getByTestId('step-lock-badge')).toHaveText('Locked');
  } finally {
    const locks = await prisma.periodLock.findMany({
      where: { orgId, name: 'Z Phase D Q1', lockedAt: { gte: seededAt } },
    });
    await prisma.grantPeriodSnapshot.deleteMany({
      where: { periodLockId: { in: locks.map((l) => l.id) } },
    });
    await prisma.periodLock.deleteMany({ where: { id: { in: locks.map((l) => l.id) } } });
    await prisma.export.deleteMany({ where: { orgId, kind: ROLLFORWARD_EXPORT_KIND } });
  }
});

test('AC7: /reports/overview renders the old cards with data-cents 2,386,589 / 216,000 / 1,382,450', async ({
  page,
}) => {
  await page.goto(`/reports/overview?asOf=${AS_OF}`);
  await expect(page.getByTestId('restricted-total')).toHaveAttribute('data-cents', String(GOLD.restrictedBalance));
  await expect(page.getByTestId('unmapped-total')).toHaveAttribute('data-cents', String(GOLD.unmappedProgramExpense));
  await expect(page.getByTestId('check-unmapped_program_expense')).toHaveAttribute('data-cents', String(GOLD.unmappedProgramExpense));
  await expect(page.getByTestId('non-grant-total')).toHaveAttribute('data-cents', String(GOLD.nonGrantExpense));
  await expect(page.getByRole('heading', { name: 'Flagged grants' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Monthly expense' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Health checks' })).toBeVisible();
  // Linked from /reports and from checklist step 3.
  await page.goto('/reports');
  await expect(page.getByTestId('overview-link')).toHaveAttribute('href', '/reports/overview');
  await page.goto(`/?asOf=${AS_OF}`);
  const step3 = page.locator('[data-step="budgets"]');
  await expect(step3).toHaveAttribute('data-expanded', 'true');
  await expect(step3.getByTestId('restricted-total')).toHaveAttribute('data-cents', String(GOLD.restrictedBalance));
  await expect(step3.getByRole('link', { name: 'overview' })).toHaveAttribute('href', `/reports/overview?asOf=${AS_OF}`);
});

test('AC8: sidebar has "Activity log" and no "Runs"/"Import"; /runs, /runs/[id], /import, /import/[id] still return 200', async ({
  page,
  request,
}) => {
  await page.goto('/');
  const sidebar = page.getByRole('complementary', { name: 'Sidebar' });
  await expect(sidebar.getByRole('link', { name: 'Activity log' })).toHaveAttribute('href', '/activity');
  await expect(sidebar.getByRole('link', { name: 'Runs' })).toHaveCount(0);
  await expect(sidebar.getByRole('link', { name: 'Import' })).toHaveCount(0);
  await expect(sidebar.locator('[data-nav-group="Data"] a')).toHaveText(['Activity log']);

  const run = await prisma.computeRun.findFirstOrThrow({ where: { orgId }, orderBy: { startedAt: 'desc' } });
  const batch = await prisma.importBatch.findFirstOrThrow({ where: { orgId }, orderBy: { startedAt: 'desc' } });
  for (const path of ['/runs', `/runs/${run.id}`, '/import', `/import/${batch.id}`, '/activity']) {
    const res = await request.get(path);
    expect(res.status(), path).toBe(200);
  }
  // The only "Recalculate now" lives on /activity, and it still works.
  await page.goto('/runs');
  await expect(page.getByRole('button', { name: /Recalculate now|Recompute/ })).toHaveCount(0);
  await page.goto('/activity');
  await expect(page.getByTestId('activity-table').locator('tbody tr').first()).toBeVisible();
  const before = await currentRun();
  await page.getByTestId('recalculate-now').click();
  await page.waitForURL(/\/activity\?done=/);
  const after = await currentRun();
  expect(after.id).not.toBe(before.id);
  expect(after.trigger).toBe('manual');
  await expect(chip(page)).toHaveText('Updated just now');
});

test('AC9: "Compute run", "Recompute", "stale", "config hash", "pieces" are absent from /, /review, /restricted, /grants/[id]; the header has no "Run <date> UTC"', async ({
  request,
}) => {
  const grant = await prisma.grant.findFirstOrThrow({ where: { orgId }, orderBy: { name: 'asc' } });
  const textOf = (html: string) =>
    html
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<[^>]+>/g, ' ')
      .replace(/&nbsp;/g, ' ')
      .replace(/\s+/g, ' ');
  const forbidden = ['compute run', 'recompute', 'stale', 'config hash', 'pieces'];
  const offenders: string[] = [];
  for (const route of ['/', '/review', '/restricted', `/grants/${grant.id}`, '/activity', `/reports/overview`]) {
    const res = await request.get(route);
    expect(res.ok(), route).toBe(true);
    const text = textOf(await res.text()).toLowerCase();
    for (const term of forbidden) if (text.includes(term)) offenders.push(`${route}: "${term}"`);
    if (/\brun [a-z]{3} \d{1,2}, \d{4}.*utc/i.test(text)) offenders.push(`${route}: Run <date> UTC`);
  }
  expect(offenders).toEqual([]);
});
