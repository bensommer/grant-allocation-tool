'use server';

import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { redirect } from 'next/navigation';
import { CSV_FILES, CsvDataSource, type CsvFileName } from '@/datasource/csv/adapter';
import { FULL_RANGE, runImport } from '@/datasource/import-service';
import { parseDateInput } from '@/domain/dates';
import { getOrgId } from '@/lib/org';

/**
 * Multipart upload → temp dir → CsvDataSource → ImportService → redirect to the
 * batch page. Works with JS disabled (plain <form method="post" encType="multipart/form-data">).
 */
export async function uploadCsvBundle(formData: FormData): Promise<void> {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'import-'));
  try {
    const files = formData
      .getAll('files')
      .filter((f): f is File => f instanceof File && f.size > 0);
    const missing: string[] = [];
    const seen = new Set<CsvFileName>();
    for (const f of files) {
      const name = path.basename(f.name).toLowerCase();
      const known = (CSV_FILES as readonly string[]).includes(name) || name === 'trial_balance.csv';
      if (!known) continue;
      await writeFile(path.join(dir, name), Buffer.from(await f.arrayBuffer()));
      if (name !== 'trial_balance.csv') seen.add(name as CsvFileName);
    }
    for (const f of CSV_FILES) if (!seen.has(f)) missing.push(f);
    if (files.length === 0 || missing.length === CSV_FILES.length) {
      redirect(
        `/import?error=${encodeURIComponent('Select the six CSV files (company, accounts, classes, locations, parties, transactions).')}`,
      );
    }
    const fromRaw = String(formData.get('from') ?? '').trim();
    const toRaw = String(formData.get('to') ?? '').trim();
    let range = FULL_RANGE;
    let fullRange = true;
    if (fromRaw || toRaw) {
      try {
        range = {
          from: fromRaw ? parseDateInput(fromRaw) : FULL_RANGE.from,
          to: toRaw ? parseDateInput(toRaw) : FULL_RANGE.to,
        };
        fullRange = false;
      } catch {
        redirect(`/import?error=${encodeURIComponent('Dates must be YYYY-MM-DD or MM/DD/YYYY.')}`);
      }
    }
    const orgId = await getOrgId();
    const result = await runImport(orgId, new CsvDataSource({ dir }), range, { fullRange });
    redirect(`/import/${result.batchId}`);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
