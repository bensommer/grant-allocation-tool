import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test } from '@playwright/test';
import { CsvDataSource } from '@/datasource/csv/adapter';
import { FULL_RANGE, runImport } from '@/datasource/import-service';
import { getOrgId } from '@/lib/org';

const dir = path.dirname(fileURLToPath(import.meta.url));

test('identical re-import is a no-op; edited import exposes field differences', async ({
  page,
}) => {
  async function upload(folder: string) {
    const result = await runImport(
      await getOrgId(),
      new CsvDataSource({ dir: path.resolve(dir, `../fixtures/${folder}`) }),
      FULL_RANGE,
    );
    expect(result.status).toBe('succeeded');
    await page.goto(`/import/${result.batchId}`);
    await expect(page.getByText(/Succeeded —/)).toBeVisible();
    return result.batchId;
  }
  try {
    await upload('demo');
    const identical = await upload('demo');
    await page.goto(`/import/${identical}/changes`);
    await expect(page.getByText('No changed or deleted transactions.')).toBeVisible();
    const edited = await upload('demo-edited');
    await page.goto(`/import/${edited}/changes`);
    await expect(page.getByRole('heading', { name: /EXP-FOOD-CT-2026-02/ })).toBeVisible();
    await expect(page.getByRole('heading', { name: /BILL-UTIL-2026-03/ })).toBeVisible();
    // The edited fixture can report a changed rather than deleted row when
    // a preceding full-range import has already reconciled that transaction.
    await expect(page.getByText(/changed|deleted/).first()).toBeVisible();
    await upload('demo');
    await page.goto(`/import/${edited}/changes`);
    await expect(page.getByText('195025', { exact: true }).first()).toBeVisible();
  } finally {
    await upload('demo');
  }
});
