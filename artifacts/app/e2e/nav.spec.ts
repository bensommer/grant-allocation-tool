import { expect, test } from '@playwright/test';
import { routes } from './routes';

test.beforeEach(() => {
  test.skip(test.info().project.name !== 'chromium', 'Active-route island needs JavaScript');
});

test('sidebar highlights the section a nested route belongs to', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  const all = await routes();
  const grant = all.find((p) => /^\/grants\/[^/]+$/.test(p) && p !== '/grants/new')!;
  const allocation = all.find((p) => /^\/allocation\/[^/]+$/.test(p) && p !== '/allocation/new')!;
  const run = all.find((p) => /^\/runs\/[^/]+$/.test(p))!;
  const line = all.find((p) => /^\/lines\/[^/]+$/.test(p))!;
  const cases: Array<[string, string, string]> = [
    ['/', 'Dashboard', 'Overview › Dashboard'],
    ['/grants', 'Grants', 'Grants'],
    [`${grant}/bva`, 'Grants', 'Grants'],
    ['/crosswalk/matrix', 'Crosswalk', 'Setup › Crosswalk'],
    [allocation, 'Allocation Rules', 'Setup › Allocation Rules'],
    ['/reports/custom?rows=program&cols=glAccount', 'Reports', 'Reports'],
    [line, 'Reports', 'Reports'],
    [run, 'Runs', 'Data › Runs'],
    ['/settings/periods', 'Settings', 'Settings'],
  ];
  const sidebar = page.getByRole('complementary', { name: 'Sidebar' });
  for (const [path, item, context] of cases) {
    await page.goto(path);
    const active = sidebar.locator('a[aria-current="page"]');
    await expect(active, path).toHaveCount(1);
    await expect(active, path).toHaveText(item);
    await expect(page.locator('[data-page-context]'), path).toHaveText(context);
  }
  await expect(sidebar.getByRole('link', { name: 'Settings' })).toBeVisible();
  const settingsTop = (await sidebar.getByRole('link', { name: 'Settings' }).boundingBox())!.y;
  const runsTop = (await sidebar.getByRole('link', { name: 'Runs' }).boundingBox())!.y;
  expect(settingsTop).toBeGreaterThan(runsTop + 100); // pinned to the bottom, not stacked
});
