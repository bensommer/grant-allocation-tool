import { expect, test } from '@playwright/test';

// Runs in two projects: "chromium" and "chromium-nojs" (javaScriptEnabled: false).
// Navigation between pages must work purely through server-rendered <a> links.
test('nav shell links resolve to server-rendered pages', async ({ page }) => {
  await page.goto('/grants');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Grants');
  // Desktop grouped links are visible; no-JS mobile uses the native details element.
  if ((page.viewportSize()?.width ?? 1280) < 1024) {
    await page.getByRole('navigation', { name: 'Main navigation' }).getByText('Menu').click();
  }
  await page.getByRole('navigation').getByRole('link', { name: 'Programs' }).click();
  await expect(page).toHaveURL(/\/programs$/);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Programs');
});
