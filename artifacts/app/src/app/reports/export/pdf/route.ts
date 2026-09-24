import { chromium } from '@playwright/test';
import { existsSync } from 'node:fs';
import { getOrgId } from '@/lib/org';
import { parseParams } from '@/reports/params';
import { loadReport } from '@/reports/query';
export async function GET(request: Request) {
  const url = new URL(request.url),
    p = parseParams(url.searchParams);
  const { run } = await loadReport(await getOrgId(), p);
  if (!run) return new Response('No current run', { status: 404 });
  const browser = await chromium.launch({
    headless: true,
    executablePath:
      process.env.PLAYWRIGHT_CHROMIUM_PATH ??
      (existsSync('/repl/tools/bin/chromium') ? '/repl/tools/bin/chromium' : undefined),
  });
  try {
    const page = await browser.newPage();
    // Use the same application origin and pinned run to preserve tenant/report state.
    url.pathname = '/reports/print';
    url.searchParams.set('run', run.id);
    await page.goto(url.toString(), { waitUntil: 'networkidle' });
    const pdf = await page.pdf({
      format: 'Letter',
      landscape: true,
      printBackground: true,
      displayHeaderFooter: true,
      headerTemplate: '<span></span>',
      footerTemplate:
        '<div style="font-size:9px;width:100%;text-align:right;margin-right:35px">Page <span class="pageNumber"></span> of <span class="totalPages"></span></div>',
    });
    return new Response(new Uint8Array(pdf), {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': 'attachment; filename="report.pdf"',
      },
    });
  } finally {
    await browser.close();
  }
}
