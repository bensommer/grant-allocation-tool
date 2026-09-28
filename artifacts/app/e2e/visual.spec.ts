import { expect, test } from '@playwright/test';
import { routes } from './routes';
import { execFileSync } from 'node:child_process';
import { prisma } from '../src/lib/db';
import { removeQboReportData } from './qbo-cleanup';

const pages = [
  'dashboard',
  'grants',
  'grant-overview',
  'bva',
  'restricted',
  'crosswalk-matrix',
  'allocation-editor',
  'reports-custom',
  'import',
  'runs',
  'narratives',
  'settings',
] as const;

test('twelve key pages at desktop and mobile', async ({ page }) => {
  const org = await prisma.org.findFirstOrThrow({ orderBy: { createdAt: 'asc' } });
  const leftovers = await prisma.grant.findMany({
    where: { orgId: org.id, name: { startsWith: 'E2E Grant ' } },
    select: { id: true },
  });
  // The report-import spec writes a scoped import into the demo org; take it back out first.
  await removeQboReportData(org.id);
  for (const grant of leftovers) {
    await prisma.allocatedLine.deleteMany({ where: { orgId: org.id, grantId: grant.id } });
    await prisma.grant.delete({ where: { id: grant.id } });
  }
  await prisma.program.deleteMany({ where: { orgId: org.id, name: 'Temp program' } });
  // The demo fixture ships no narratives; the narratives spec leaves drafts behind.
  await prisma.narrative.deleteMany({ where: { orgId: org.id } });
  // Other e2e cases write imports and rules. Restore the documented fixture so
  // screenshots always describe the same current computation.
  for (const [command, args] of [
    ['pnpm', ['import:csv', '--', '--dir', 'fixtures/demo']],
    ['pnpm', ['seed:demo']],
    ['pnpm', ['recompute']],
  ] as const)
    execFileSync(command, args, { stdio: 'pipe' });
  const all = await routes();
  const grant = all.find((p) => /^\/grants\/[^/]+$/.test(p) && !p.startsWith('/grants/new'))!;
  const allocation = all.find((p) => /^\/allocation\/[^/]+$/.test(p) && p !== '/allocation/new')!;
  const paths = [
    '/',
    '/grants',
    grant,
    `${grant}/bva`,
    '/restricted',
    '/crosswalk/matrix',
    allocation,
    '/reports/custom',
    '/import',
    '/runs',
    '/narratives',
    '/settings',
  ];
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: width === 390 ? 844 : 900 });
    for (let i = 0; i < pages.length; i++) {
      await page.goto(paths[i]!, { waitUntil: 'networkidle' });
      // The Next dev-tools badge appears only when the dev overlay has logged something.
      await page.addStyleTag({ content: 'nextjs-portal { display: none !important; }' });
      if (paths[i] === '/import' || paths[i] === '/runs') {
        await page.addStyleTag({ content: 'main tbody { display: none !important; }' });
      }
      await expect(page).toHaveScreenshot(`${pages[i]}-${width}.png`, {
        fullPage: true,
        animations: 'disabled',
        mask:
          paths[i] === '/import' || paths[i] === '/runs'
            ? [page.locator('header.app-header [data-volatile]')]
            : [page.locator('[data-volatile]')],
        maxDiffPixelRatio: 0.01,
      });
    }
  }
});
