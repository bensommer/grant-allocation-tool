import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import { routes } from './routes';

test.setTimeout(600_000);
test.beforeEach(() => {
  test.skip(test.info().project.name !== 'chromium', 'axe requires JavaScript');
});

test.describe('WCAG AA on every server route', () => {
  let paths: string[];
  test.beforeAll(async () => {
    paths = await routes();
  });
  test('no serious or critical axe violations', async ({ page }) => {
    const failures: Array<{ path: string; id: string; nodes: string[] }> = [];
    for (const path of paths) {
      await page.goto(path);
      const result = await new AxeBuilder({ page })
        .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'best-practice'])
        .analyze();
      const violations = result.violations.filter(
        (v) => v.impact === 'serious' || v.impact === 'critical',
      );
      console.log(`AXE ${path}: ${violations.length} serious/critical`);
      failures.push(
        ...violations.map((v) => ({
          path,
          id: v.id,
          nodes: v.nodes.map((n) => `${n.target.join(' ')}: ${n.failureSummary}`),
        })),
      );
    }
    expect(failures).toEqual([]);
  });
});
