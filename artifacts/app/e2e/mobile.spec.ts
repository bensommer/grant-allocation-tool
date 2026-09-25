import { expect, test } from '@playwright/test';
import { routes } from './routes';

test('every route fits a 390px viewport; navigation stays collapsed', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  for (const path of await routes()) {
    await page.goto(path);
    const dimensions = await page.evaluate(() => ({
      html: document.documentElement.scrollWidth,
      body: document.body.scrollWidth,
      menuOpen: document.querySelector('nav details')?.hasAttribute('open'),
    }));
    expect(dimensions.html, `${path}: html`).toBeLessThanOrEqual(390);
    expect(dimensions.body, `${path}: body`).toBeLessThanOrEqual(390);
    expect(dimensions.menuOpen, `${path}: menu`).toBe(false);
  }
});

test('desktop shows the sidebar and a slim header', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto('/');
  const sidebar = page.getByRole('complementary', { name: 'Sidebar' });
  await expect(sidebar).toBeVisible();
  const width = await sidebar.evaluate((el) => el.getBoundingClientRect().width);
  expect(width).toBeGreaterThanOrEqual(200);
  expect(width).toBeLessThanOrEqual(240);
  const header = await page.locator('header.app-header').boundingBox();
  expect(header!.height).toBeLessThan(60);
  await expect(page.getByText('Menu', { exact: true })).toBeHidden();
});
