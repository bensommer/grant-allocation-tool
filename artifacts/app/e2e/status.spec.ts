import { expect, test } from '@playwright/test';
import { prisma } from '../src/lib/db';
import { markCurrentRunStale } from '../src/lib/stale';

test('one header chip reports "Needs update" and the activity log recalculates', async ({ page }) => {
  const org = await prisma.org.findFirstOrThrow({ orderBy: { createdAt: 'asc' } });
  const currentRun = () =>
    prisma.computeRun.findFirstOrThrow({ where: { orgId: org.id, isCurrent: true } });
  // Other specs recompute concurrently, so re-mark before every page load.
  const openStale = async (path: string, banners: number) => {
    await expect(async () => {
      await markCurrentRunStale(prisma, org.id);
      await page.goto(path);
      await expect(page.locator('[data-status-indicator]'), path).toHaveCount(1);
      await expect(page.getByTestId('freshness-chip'), path).toHaveAttribute('data-state', 'needs_update', { timeout: 2_000 });
      await expect(page.getByTestId('freshness-chip'), path).toContainText('Needs update');
      await expect(page.getByTestId('freshness-chip'), path).toHaveAttribute('href', '/activity');
      await expect(page.locator('[data-stale-banner]'), path).toHaveCount(banners);
    }).toPass({ timeout: 45_000 });
  };
  for (const path of ['/allocation', '/crosswalk', '/runs', '/grants']) await openStale(path, 0);
  await openStale('/reports/custom?rows=program&cols=glAccount', 1);
  // JPH-28 D3/D4: the header has no button; the chip links to the activity log, which holds
  // the only manual "Recalculate now".
  await expect(page.locator('header.app-header').getByRole('button')).toHaveCount(0);
  const before = await currentRun();
  await page.getByTestId('freshness-chip').click();
  await page.waitForURL(/\/activity$/);
  await page.getByTestId('recalculate-now').click();
  await expect.poll(async () => (await currentRun()).id, { timeout: 60_000 }).not.toBe(before.id);
  await page.waitForURL(/\/activity\?done=/);
  await page.goto('/reports/custom?rows=program&cols=glAccount');
  // The fresh run may already be stale again if another spec changed configuration meanwhile;
  // the indicator must agree with the run's flag either way.
  const after = await currentRun();
  const expected = after.stale ? 1 : 0;
  await expect(page.locator('[data-testid="freshness-chip"][data-state="needs_update"]')).toHaveCount(expected, { timeout: 30_000 });
  await expect(page.locator('[data-stale-banner]')).toHaveCount(expected);
  await expect(page.locator('[data-status-indicator]')).toContainText('Books through');
});
