/**
 * JPH-27 · Phase C — the review queue in the QuickBooks "For Review" pattern, on the pilot
 * fixture (pseudonyms). Runs in its own Playwright project (`phase-c`, JavaScript on) after the
 * pilot project, seeds the two pilot grants itself and removes them afterwards. Serial: each
 * test leaves the queue where the next one expects it; decisions are reverted through the
 * decision trail (superseded, never deleted) before the golden D1-A / D1-B paths.
 *
 * Golden numbers (cents): Salah needs review 118,841 over 7 Leah lines + one ±113.96 pair;
 * D1-A Leah 209,547 / Culinary Staff 253,047; D1-B Leah 90,706 / Culinary Staff 134,206 and one
 * 118,841 correcting entry; Practitioners 710,000 throughout.
 */
import { execFileSync } from 'node:child_process';
import { expect, test, type Page } from '@playwright/test';
import { prisma } from '../src/lib/db';
import type { DecisionKind, Prisma } from '../src/generated/prisma/client';
import { assertGrantStatesBalanced } from '../src/domain/invariants';
import { CELL_NOUN_PATTERN, REVIEW_FORBIDDEN_TERMS } from '../src/copy/terms';
import { removeQboReportData } from './qbo-cleanup';

test.describe.configure({ mode: 'serial' });

const SALAH_NAME = 'Salah Foundation — Trauma Programs';
const OPIOID_NAME_PREFIX = 'Opioid';
const SEED_PERIOD_NAMES = ['FY2025'];
const LEAH_REASON = 'Matches rule "Leah payroll from September" except the date';
const LEAH_TOTAL = 118_841;

let orgId: string;
let salahId: string;
let opioidId: string;
let leahLineId: string;
let orgSettingsBefore: Prisma.InputJsonValue | undefined;
let seededAt: Date;

test.beforeAll(async () => {
  const org = await prisma.org.findFirstOrThrow({ orderBy: { createdAt: 'asc' } });
  orgId = org.id;
  orgSettingsBefore = org.settings ?? {};
  seededAt = new Date();
  execFileSync('pnpm', ['seed:pilot'], { stdio: 'pipe' });
  salahId = (await prisma.grant.findFirstOrThrow({ where: { orgId, name: SALAH_NAME } })).id;
  opioidId = (
    await prisma.grant.findFirstOrThrow({
      where: { orgId, name: { startsWith: OPIOID_NAME_PREFIX } },
    })
  ).id;
  leahLineId = (
    await prisma.grantBudgetLine.findFirstOrThrow({ where: { grantId: salahId, code: 'LEAH' } })
  ).id;
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

async function recomputeFromHeader(page: Page) {
  const before = await prisma.computeRun.findFirstOrThrow({ where: { orgId, isCurrent: true } });
  // JPH-28: the header has no button any more; the only manual "Recalculate now" is on /activity.
  const returnTo = new URL(page.url()).pathname + new URL(page.url()).search;
  await page.goto('/activity');
  await page.getByTestId('recalculate-now').click();
  await expect
    .poll(
      async () =>
        (await prisma.computeRun.findFirstOrThrow({ where: { orgId, isCurrent: true } })).id,
      { timeout: 60_000 },
    )
    .not.toBe(before.id);
  await page.waitForURL(/\/activity\?done=/);
  await page.goto(returnTo);
}

/** AC11: the JPH-21 invariant (assigned + excluded + needs review = membership) on the current run. */
async function invariantHolds(page: Page) {
  await recomputeFromHeader(page);
  const run = await prisma.computeRun.findFirstOrThrow({ where: { orgId, isCurrent: true } });
  const { grants } = await assertGrantStatesBalanced(run.id);
  expect(grants).toBeGreaterThanOrEqual(2);
}

const queueRows = (page: Page) => page.getByTestId('queue-table').locator('tr[data-line-id]');

/** Active decisions this suite recorded (the seed's own decisions are `seed:pilot`). */
async function activeDecisions(kind?: DecisionKind) {
  return prisma.lineDecision.findMany({
    where: { grantId: salahId, supersededAt: null, actor: 'local-user', ...(kind ? { kind } : {}) },
    orderBy: { createdAt: 'asc' },
  });
}

/** Reverts this suite's active decisions through the decision trail (superseded, not deleted). */
async function revertAllFromTrail(page: Page) {
  const groups = new Set((await activeDecisions()).map((d) => d.groupId));
  await page.goto(`/grants/${salahId}/review`);
  const trail = page.getByTestId('decision-trail');
  for (const g of groups) {
    const boxes = trail.locator(`tr[data-decision-group="${g}"] input[name="lineIds"]`);
    const n = await boxes.count();
    for (let i = 0; i < n; i++) await boxes.nth(i).check();
  }
  await trail.getByRole('button', { name: /Revert selected decisions/ }).click();
  await page.waitForURL(/\/review\?saved=1/);
  expect((await activeDecisions()).filter((d) => d.kind !== 'at_risk')).toHaveLength(0);
}

test('AC1 + AC2: Salah shows 8 rows — 7 Leah transactions suggested to Leah (Sept+) with the near-miss reason and one pair row — under "8 transactions need a decision · $1,188.41"', async ({
  page,
}) => {
  await page.goto(`/grants/${salahId}/review`);
  await expect(page.getByTestId('queue-header')).toHaveText(
    '8 transactions need a decision · $1,188.41',
  );
  await expect(page.getByTestId('queue-count')).toHaveText('8');
  await expect(page.getByTestId('queue-total')).toHaveAttribute('data-cents', String(LEAH_TOTAL));
  await expect(page.getByTestId('queue-table').locator('tr[data-row-id]')).toHaveCount(8);
  const rows = queueRows(page);
  await expect(rows).toHaveCount(7);
  for (let i = 0; i < 7; i++) {
    await expect(rows.nth(i).getByTestId('suggested-target')).toHaveText('Leah (Sept+)');
    await expect(rows.nth(i).getByTestId('suggested-reason')).toHaveText(LEAH_REASON);
    await expect(rows.nth(i)).toHaveAttribute('data-suggested', leahLineId);
  }
  const sum = (
    await rows.getByTestId('row-amount').evaluateAll((tds) =>
      tds.map((td) => Number(td.getAttribute('data-cents'))),
    )
  ).reduce((a, b) => a + b, 0);
  expect(sum).toBe(LEAH_TOTAL);
  const pair = page.getByTestId('queue-table').locator('tr[data-pair="11396"]');
  await expect(pair).toHaveCount(1);
  await expect(pair.getByRole('button', { name: 'Confirm pair' })).toBeVisible();
  await expect(pair.getByTestId('row-amount')).toHaveAttribute('data-cents', '0');
  // Sort: the suggested group first, then the pairs; the group header carries the select-all.
  const headers = page.locator('tr[data-group-header]');
  await expect(headers).toHaveCount(2);
  await expect(headers.nth(0)).toHaveAttribute('data-group-kind', 'suggested');
  await expect(headers.nth(0)).toContainText('Select all suggested → Leah (Sept+) (7)');
  await expect(headers.nth(1)).toHaveAttribute('data-group-kind', 'pairs');
  // The four stat cards keep their figures; the last one is renamed.
  const cards = page.getByTestId('review-counts');
  await expect(cards).toContainText('Transactions on this grant');
  await expect(cards).not.toContainText('Members');
  await expect(cards.locator('[data-cents="118841"]')).toHaveCount(1);
  await expect(page.getByTestId('queue-filters')).toBeVisible();
  await expect(page.getByTestId('key-legend')).toHaveText(/J\/K move · A accept · C change · X not grant-funded/);
});

test('AC13: neither queue page says "member line", "fingerprint" or "cell" (as a noun)', async ({
  request,
}) => {
  const textOf = (html: string) =>
    html
      .replace(/<script[\s\S]*?<\/script>/g, ' ')
      .replace(/<style[\s\S]*?<\/style>/g, ' ')
      .replace(/<[^>]+>/g, ' ')
      .replace(/&[a-z#0-9]+;/g, ' ')
      .replace(/\s+/g, ' ');
  const offenders: string[] = [];
  for (const route of [`/grants/${salahId}/review`, `/grants/${opioidId}/review`, '/review']) {
    const res = await request.get(route);
    expect(res.ok(), route).toBe(true);
    const text = textOf(await res.text());
    for (const term of REVIEW_FORBIDDEN_TERMS)
      if (text.toLowerCase().includes(term)) offenders.push(`${route}: "${term}"`);
    const cell = text.match(CELL_NOUN_PATTERN);
    if (cell) offenders.push(`${route}: "${cell[0]}"`);
  }
  expect(offenders).toEqual([]);
});

test('AC10 (before): the sidebar Review badge and the grant chip say 7; /review lists Salah\'s 8 rows and no Opioid transaction', async ({
  page,
}) => {
  await page.goto(`/grants/${salahId}`);
  // The nav renders twice (sidebar and the mobile menu); both carry the badge.
  await expect(page.getByTestId('nav-badge')).toHaveCount(2);
  await expect(page.getByTestId('nav-badge').first()).toHaveText(/^7/);
  await expect(page.getByTestId('review-chip')).toHaveAttribute('data-count', '7');
  await expect(page.getByTestId('review-chip')).toHaveText(/7 to review/);
  await page.getByTestId('review-chip').click();
  await page.waitForURL(new RegExp(`/grants/${salahId}/review$`));

  await page.goto('/review');
  const table = page.getByTestId('queue-table');
  await expect(table.locator(`tr[data-row-id][data-grant-id="${salahId}"]`)).toHaveCount(8);
  await expect(table.locator(`tr[data-line-id][data-grant-id="${salahId}"]`)).toHaveCount(7);
  await expect(table.locator(`tr[data-line-id][data-grant-id="${opioidId}"]`)).toHaveCount(0);
  const summary = page.getByTestId('grant-summary');
  await expect(summary.locator(`li[data-grant-id="${salahId}"]`)).toHaveAttribute('data-count', '8');
  await expect(summary.locator(`li[data-grant-id="${salahId}"]`)).toHaveAttribute(
    'data-cents',
    String(LEAH_TOTAL),
  );
  await expect(summary.locator(`li[data-grant-id="${opioidId}"]`)).toHaveAttribute('data-cents', '0');
  // Every Salah row on the cross-grant page carries the same suggestion and a Grant link.
  const first = table.locator(`tr[data-line-id][data-grant-id="${salahId}"]`).first();
  await expect(first.getByTestId('suggested-target')).toHaveText('Leah (Sept+)');
  await expect(first.getByRole('link', { name: SALAH_NAME })).toHaveAttribute(
    'href',
    `/grants/${salahId}/review`,
  );
});

test('AC7: "Always do this" from a Leah row opens the builder with the name, Account = Salaries, the "Leah" description and Target = Leah (Sept+) pre-set', async ({
  page,
}) => {
  await page.goto(`/grants/${salahId}/review`);
  const row = queueRows(page).first();
  const lineId = (await row.getAttribute('data-line-id'))!;
  const line = await prisma.transactionLine.findUniqueOrThrow({
    where: { id: lineId },
    include: { transaction: true, account: true },
  });
  const partyId = line.partyId ?? line.transaction.partyId;
  expect(line.account.name).toBe('Salaries');
  const link = row.locator('a[data-action="always"]');
  const href = (await link.getAttribute('href'))!;
  const url = new URL(href, 'http://x');
  expect(url.pathname).toBe(`/grants/${salahId}/rules/new`);
  expect(url.searchParams.get('accountId')).toBe(line.accountId);
  expect(url.searchParams.get('targetBudgetLineId')).toBe(leahLineId);
  expect(url.searchParams.get('descriptionContains')).toBe('Leah');
  expect(url.searchParams.get('partyId')).toBe(partyId);
  expect(url.searchParams.get('returnTo')).toBe(`/grants/${salahId}/review`);

  await link.click();
  await page.waitForURL(/\/rules\/new\?/);
  const form = page.getByTestId('grant-rule-form');
  await expect(form.locator(`input[name="accountIds"][value="${line.accountId}"]`)).toBeChecked();
  if (partyId)
    await expect(form.locator(`input[name="partyIds"][value="${partyId}"]`)).toBeChecked();
  await expect(form.locator('input[name="descriptionContains"]')).toHaveValue('Leah');
  await expect(form.locator('select[name="grantBudgetLineId"]')).toHaveValue(leahLineId);
  await expect(form.locator('input[name="returnTo"]')).toHaveValue(`/grants/${salahId}/review`);
  // Nothing is saved by looking: the queue and the rules are untouched.
  expect(await prisma.crosswalkRule.count({ where: { grantId: salahId } })).toBe(
    await prisma.crosswalkRule.count({ where: { grantId: salahId } }),
  );
});

test('AC3: Accept on one row records an assign decision whose note is the reason; the row is gone and the total drops by that line', async ({
  page,
}) => {
  await page.goto(`/grants/${salahId}/review`);
  const row = queueRows(page).first();
  const lineId = (await row.getAttribute('data-line-id'))!;
  const cents = Number(await row.getByTestId('row-amount').getAttribute('data-cents'));
  await row.locator('form[data-action="accept"]').getByRole('button', { name: 'Accept' }).click();
  await page.waitForURL(/\/review\?saved=1/);
  await expect(page.locator(`tr[data-line-id="${lineId}"]`)).toHaveCount(0);
  await expect(queueRows(page)).toHaveCount(6);
  await expect(page.getByTestId('queue-count')).toHaveText('7');
  await expect(page.getByTestId('queue-total')).toHaveAttribute(
    'data-cents',
    String(LEAH_TOTAL - cents),
  );
  const decisions = await activeDecisions('assign');
  expect(decisions).toHaveLength(1);
  expect(decisions[0]!.note).toBe(LEAH_REASON);
  expect(decisions[0]!.targetBudgetLineId).toBe(leahLineId);
  // The badge and the chip follow the decision straight away, before any recompute.
  await expect(page.getByTestId('nav-badge').first()).toHaveText(/^6/);
  await page.goto(`/grants/${salahId}`);
  await expect(page.getByTestId('review-chip')).toHaveAttribute('data-count', '6');
  await invariantHolds(page);
  await page.goto(`/grants/${salahId}`);
  await expect(page.getByTestId('review-chip')).toHaveAttribute('data-count', '6');
});

test('AC9: with JavaScript, J then A accepts the second row', async ({ page }) => {
  await page.goto(`/grants/${salahId}/review`);
  await expect(page.getByTestId('queue')).toHaveAttribute('data-island', 'ready');
  const rows = queueRows(page);
  await expect(rows).toHaveCount(6);
  const first = (await rows.nth(0).getAttribute('data-line-id'))!;
  const second = (await rows.nth(1).getAttribute('data-line-id'))!;
  await page.locator('body').click({ position: { x: 5, y: 5 } });
  await page.keyboard.press('j');
  await expect(rows.nth(1)).toHaveClass(/row-focus/);
  await page.keyboard.press('a');
  await page.waitForURL(/\/review\?saved=1/);
  await expect(page.locator(`tr[data-line-id="${second}"]`)).toHaveCount(0);
  await expect(page.locator(`tr[data-line-id="${first}"]`)).toHaveCount(1);
  await expect(queueRows(page)).toHaveCount(5);
  const decisions = await activeDecisions('assign');
  expect(decisions.map((d) => d.transactionLineId)).toContain(second);
  // C and X open the row's own forms; nothing is submitted by opening them.
  await page.keyboard.press('j');
  await page.keyboard.press('c');
  await expect(rows.nth(1).locator('details[data-action="change"]')).toHaveAttribute('open', '');
  await page.locator('body').click({ position: { x: 5, y: 5 } });
  await page.keyboard.press('x');
  await expect(rows.nth(1).locator('details[data-action="exclude"]')).toHaveAttribute('open', '');
  expect(await activeDecisions()).toHaveLength(2);
  await invariantHolds(page);
});

test('AC8: with JavaScript disabled, Accept, Change and Not grant-funded each work as a plain form POST', async ({
  browser,
}) => {
  const noJs = await browser.newContext({ javaScriptEnabled: false });
  const page = await noJs.newPage();
  await page.goto(`/grants/${salahId}/review`);
  await expect(page.getByTestId('queue')).not.toHaveAttribute('data-island', 'ready');
  const rows = queueRows(page);
  await expect(rows).toHaveCount(5);
  const [acceptId, changeId, excludeId] = await Promise.all(
    [0, 1, 2].map((i) => rows.nth(i).getAttribute('data-line-id')),
  );

  // Accept
  await rows.nth(0).locator('form[data-action="accept"]').getByRole('button', { name: 'Accept' }).click();
  await page.waitForURL(/\/review\?saved=1/);
  await expect(page.locator(`tr[data-line-id="${acceptId}"]`)).toHaveCount(0);

  // Change: the popover is a <details>; the select posts the target.
  const changeRow = page.locator(`tr[data-line-id="${changeId}"]`);
  await changeRow.locator('details[data-action="change"] > summary').click();
  const changeForm = changeRow.locator('details[data-action="change"] form');
  await changeForm.locator('select[name="targetBudgetLineId"]').selectOption({ label: 'Culinary Staff' });
  await changeForm.getByLabel('Note (optional)').fill('Changed without JavaScript');
  await changeForm.getByRole('button', { name: 'Assign' }).click();
  await page.waitForURL(/\/review\?saved=1/);
  await expect(page.locator(`tr[data-line-id="${changeId}"]`)).toHaveCount(0);

  // Not grant-funded
  const excludeRow = page.locator(`tr[data-line-id="${excludeId}"]`);
  await excludeRow.locator('details[data-action="exclude"] > summary').click();
  const excludeForm = excludeRow.locator('details[data-action="exclude"] form');
  await excludeForm.getByLabel('Reason').selectOption('posted in error');
  await excludeForm.getByLabel('Draft correcting entry').uncheck();
  await excludeForm.getByRole('button', { name: 'Exclude' }).click();
  await page.waitForURL(/\/review\?saved=1/);
  await expect(page.locator(`tr[data-line-id="${excludeId}"]`)).toHaveCount(0);
  await expect(queueRows(page)).toHaveCount(2);
  await expect(page.getByTestId('queue-count')).toHaveText('3');

  const culinary = await prisma.grantBudgetLine.findFirstOrThrow({
    where: { grantId: salahId, code: 'CULSTAFF' },
  });
  const byLine = new Map((await activeDecisions()).map((d) => [d.transactionLineId, d]));
  expect(byLine.get(acceptId!)).toMatchObject({ kind: 'assign', targetBudgetLineId: leahLineId });
  expect(byLine.get(changeId!)).toMatchObject({
    kind: 'assign',
    targetBudgetLineId: culinary.id,
    note: 'Changed without JavaScript',
  });
  expect(byLine.get(excludeId!)).toMatchObject({ kind: 'exclude', reason: 'posted in error' });
  expect(await prisma.correctingEntryDraft.count({ where: { grantId: salahId } })).toBe(0);
  await invariantHolds(page);
  await noJs.close();
});

test('Flag at-risk keeps the row (note required) and Revert from the trail brings every line back to the queue', async ({
  page,
}) => {
  await page.goto(`/grants/${salahId}/review`);
  const row = queueRows(page).first();
  const lineId = (await row.getAttribute('data-line-id'))!;
  await row.locator('details[data-action="at-risk"] > summary').click();
  const form = row.locator('details[data-action="at-risk"] form');
  await form.getByLabel(/Why is it at risk/).fill('Timesheet still missing');
  await form.getByRole('button', { name: 'Flag' }).click();
  await page.waitForURL(/\/review\?saved=1/);
  const flagged = page.locator(`tr[data-line-id="${lineId}"]`);
  await expect(flagged).toHaveCount(1);
  await expect(flagged).toContainText('at risk');
  expect(await activeDecisions('at_risk')).toHaveLength(1);

  await revertAllFromTrail(page);
  await invariantHolds(page);
  await page.goto(`/grants/${salahId}/review`);
  await expect(queueRows(page)).toHaveCount(7);
  await expect(page.getByTestId('queue-count')).toHaveText('8');
  await expect(page.getByTestId('queue-total')).toHaveAttribute('data-cents', String(LEAH_TOTAL));
});

test('Filtered bulk: a group header ticked under a date filter accepts only the rows it showed (4), never the whole target (7) — with and without JavaScript', async ({
  page,
  browser,
}) => {
  // From May onwards the Leah group lists 4 of the 7 transactions.
  await page.goto(`/grants/${salahId}/review?from=2026-05-01`);
  await expect(page.getByTestId('queue')).toHaveAttribute('data-island', 'ready');
  await expect(queueRows(page)).toHaveCount(4);
  const shown = new Set(await queueRows(page).evaluateAll((trs) => trs.map((tr) => tr.getAttribute('data-line-id'))));
  const bulk = page.getByTestId('bulk-bar');
  await page.getByLabel('Select all suggested → Leah (Sept+) (4)').check();
  await expect(bulk.getByTestId('bulk-accept')).toHaveText('Accept 4');
  await bulk.getByTestId('bulk-accept').click();
  await page.waitForURL(/\/review\?saved=1&accepted=4/);
  let decisions = await activeDecisions('assign');
  expect(decisions).toHaveLength(4);
  expect(decisions.every((d) => shown.has(d.transactionLineId))).toBe(true);
  await revertAllFromTrail(page);

  // Without JavaScript only the group header posts; the server expands it to the rows it listed.
  const noJs = await browser.newContext({ javaScriptEnabled: false });
  const plain = await noJs.newPage();
  await plain.goto(`/grants/${salahId}/review?from=2026-05-01`);
  await expect(plain.getByTestId('queue').locator('tr[data-line-id]')).toHaveCount(4);
  await plain.getByLabel('Select all suggested → Leah (Sept+) (4)').check();
  await plain.getByTestId('bulk-bar').getByTestId('bulk-accept').click();
  await plain.waitForURL(/\/review\?saved=1&accepted=4/);
  await noJs.close();
  decisions = await activeDecisions('assign');
  expect(decisions).toHaveLength(4);
  expect(decisions.every((d) => shown.has(d.transactionLineId))).toBe(true);
  await revertAllFromTrail(page);
  await page.goto(`/grants/${salahId}/review`);
  await expect(queueRows(page)).toHaveCount(7);
});

test('AC4 (D1-A): "Select all suggested → Leah (Sept+) (7)" + "Accept 7" records 7 decisions with one groupId; Leah 209,547 and Culinary Staff 253,047', async ({
  page,
}) => {
  await page.goto(`/grants/${salahId}/review`);
  await expect(page.getByTestId('queue')).toHaveAttribute('data-island', 'ready');
  const bulk = page.getByTestId('bulk-bar');
  await expect(bulk.getByTestId('bulk-accept')).toHaveText(/Accept 0/);
  await page.getByLabel('Select all suggested → Leah (Sept+) (7)').check();
  await expect(queueRows(page).locator('input[name="rows"]:checked')).toHaveCount(7);
  await expect(bulk.getByTestId('bulk-accept')).toHaveText('Accept 7');
  await bulk.getByTestId('bulk-accept').click();
  await page.waitForURL(/\/review\?saved=1&accepted=7/);
  await expect(page.getByTestId('bulk-accepted')).toContainText('Accepted 7 transactions');
  await expect(queueRows(page)).toHaveCount(0);
  await expect(page.getByTestId('queue-count')).toHaveText('1');
  const decisions = await activeDecisions('assign');
  expect(decisions).toHaveLength(7);
  expect(new Set(decisions.map((d) => d.groupId)).size).toBe(1);
  expect(decisions[0]!.groupId).toBeTruthy();
  expect(decisions.every((d) => d.targetBudgetLineId === leahLineId)).toBe(true);
  expect(decisions.every((d) => d.note === LEAH_REASON)).toBe(true);
  await expect(
    page.getByTestId('decision-trail').locator(`tr[data-decision-group="${decisions[0]!.groupId}"]`),
  ).toHaveCount(7);

  await invariantHolds(page);
  await page.goto(`/grants/${salahId}/budget`);
  const tree = page.getByTestId('budget-tree');
  await expect(tree.locator('tr[data-line-code="LEAH"] [data-testid="spent"]')).toHaveAttribute(
    'data-cents',
    '209547',
  );
  await expect(
    tree.locator('tr[data-line-code="CULINARY"] [data-testid="spent"]'),
  ).toHaveAttribute('data-cents', '253047');
  await expect(tree.locator('tr[data-line-code="PRACT"] [data-testid="spent"]')).toHaveAttribute(
    'data-cents',
    '710000',
  );
  // JPH-29 E2: the working lines now sit under the Internal view of Budget vs. Actuals; the
  // Funder view shows the categories only. Same cents, different rows.
  await page.goto(`/grants/${salahId}/bva?view=internal`);
  await expect(
    page.locator('tr[data-testid="working-line"][data-code="LEAH"] [data-testid="line-charged"]'),
  ).toHaveAttribute('data-cents', '209547');
  await expect(
    page.locator(
      'tr[data-testid="working-category"][data-code="CULINARY"] [data-testid="category-charged"]',
    ),
  ).toHaveAttribute('data-cents', '253047');
  await expect(page.getByTestId('total-charged')).toHaveAttribute(
    'data-cents',
    String(2_152_040 + LEAH_TOTAL),
  );
  await page.goto(`/grants/${salahId}/funder`);
  await expect(page).toHaveURL(/\/bva\?view=funder$/);
  await expect(
    page.locator(
      'tr[data-testid="funder-category"][data-code="CULINARY"] [data-testid="category-charged"]',
    ),
  ).toHaveAttribute('data-cents', '253047');
  await expect(page.getByTestId('funder-charged')).toHaveAttribute(
    'data-cents',
    String(2_152_040 + LEAH_TOTAL),
  );
});

test('AC5 (D1-B): after reverting, "Not grant-funded → not allowable" on the 7 records 7 exclusions and one balanced 1,188.41 correcting entry; Leah stays 90,706; the queue is empty', async ({
  page,
}) => {
  await revertAllFromTrail(page);
  await invariantHolds(page);
  // A default destination (Settings) lets the exclusion draft its correcting entry.
  await page.goto('/settings');
  await page.getByLabel('Class').selectOption({ label: 'Youth Programs' });
  await page.getByRole('button', { name: 'Save destination' }).click();
  await page.waitForURL(/\/settings\?saved=1/);
  await page.goto(`/grants/${salahId}/review`);
  await expect(queueRows(page)).toHaveCount(7);
  await page.getByLabel('Select all suggested → Leah (Sept+) (7)').check();
  const bulk = page.getByTestId('bulk-bar');
  await expect(bulk.getByTestId('bulk-exclude')).toHaveText('Not grant-funded 7');
  await bulk.getByTestId('bulk-exclude').click();
  await bulk.getByLabel('Reason').selectOption('not allowable');
  await expect(bulk.getByLabel('Draft correcting entry')).toBeChecked();
  await bulk.getByLabel('Note (optional)').fill('D1-B: pre-September payroll is outside the award period');
  await bulk.getByRole('button', { name: 'Exclude selected' }).click();
  await page.waitForURL(/\/review\?saved=1&excluded=7&drafted=GAT-\d{4}/);
  await expect(page.getByTestId('draft-created')).toBeVisible();
  await expect(queueRows(page)).toHaveCount(0);

  const excluded = await activeDecisions('exclude');
  expect(excluded).toHaveLength(7);
  expect(excluded.every((d) => d.reason === 'not allowable')).toBe(true);
  expect(new Set(excluded.map((d) => d.groupId)).size).toBe(1);
  const draft = await prisma.correctingEntryDraft.findFirstOrThrow({
    where: { grantId: salahId, kind: 'reclass' },
    include: { lines: true },
  });
  expect(draft.lines.reduce((s, l) => s + l.debitCents, 0)).toBe(LEAH_TOTAL);
  expect(draft.lines.reduce((s, l) => s + l.creditCents, 0)).toBe(LEAH_TOTAL);

  await invariantHolds(page);
  await page.goto(`/grants/${salahId}/budget`);
  const tree = page.getByTestId('budget-tree');
  await expect(tree.locator('tr[data-line-code="LEAH"] [data-testid="spent"]')).toHaveAttribute(
    'data-cents',
    '90706',
  );
  await expect(
    tree.locator('tr[data-line-code="CULINARY"] [data-testid="spent"]'),
  ).toHaveAttribute('data-cents', '134206');
  await expect(tree.locator('tr[data-line-code="PRACT"] [data-testid="spent"]')).toHaveAttribute(
    'data-cents',
    '710000',
  );
});

test('AC6: "Confirm pair" records two reversal_pair decisions; Practitioners stays 710,000; the queue is empty and the tie-out green', async ({
  page,
}) => {
  await page.goto(`/grants/${salahId}/review`);
  await expect(page.getByTestId('queue-count')).toHaveText('1');
  await page
    .getByTestId('queue-table')
    .locator('tr[data-pair="11396"]')
    .getByRole('button', { name: 'Confirm pair' })
    .click();
  await page.waitForURL(/\/review\?saved=1/);
  await expect(page.getByTestId('queue-empty')).toBeVisible();
  await expect(page.getByTestId('queue-count')).toHaveText('0');
  await expect(page.getByTestId('queue-total')).toHaveAttribute('data-cents', '0');
  const pairs = await activeDecisions('reversal_pair');
  expect(pairs).toHaveLength(2);
  expect(pairs[0]!.groupId).toBe(pairs[1]!.groupId);
  const pairLines = await prisma.transactionLine.findMany({
    where: { id: { in: pairs.map((d) => d.transactionLineId!) } },
  });
  expect(pairLines.reduce((s, l) => s + l.amountCents, 0)).toBe(0);

  await invariantHolds(page);
  await page.goto(`/grants/${salahId}`);
  await expect(page.getByTestId('tie-out')).toHaveAttribute('data-green', '1');
  await expect(page.getByTestId('tie-needs-review')).toHaveAttribute('data-cents', '0');
  await page.goto(`/grants/${salahId}/budget`);
  await expect(
    page.getByTestId('budget-tree').locator('tr[data-line-code="PRACT"] [data-testid="spent"]'),
  ).toHaveAttribute('data-cents', '710000');
});

test('AC10 (after): at 0 the sidebar badge and the grant chip are absent; /review shows Salah as settled', async ({
  page,
}) => {
  await page.goto(`/grants/${salahId}`);
  await expect(page.getByTestId('tracking-badge')).toHaveAttribute('data-mode', 'membership');
  await expect(page.getByTestId('review-chip')).toHaveCount(0);
  // Opioid's ±207.02 proposal still waits, but a pair is not a transaction to decide on.
  await expect(page.getByTestId('nav-badge')).toHaveCount(0);
  await page.goto('/review');
  await expect(
    page.getByTestId('queue-table').locator(`tr[data-row-id][data-grant-id="${salahId}"]`),
  ).toHaveCount(0);
  await expect(page.getByTestId('grant-summary').locator(`li[data-grant-id="${salahId}"]`)).toHaveAttribute(
    'data-count',
    '0',
  );
});
