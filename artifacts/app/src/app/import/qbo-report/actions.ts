'use server';

import path from 'node:path';
import { redirect } from 'next/navigation';
import { runImport } from '@/datasource/import-service';
import { QboReportDataSource, accountTypeOverrides } from '@/datasource/qbo-report/adapter';
import { parseQboReport } from '@/datasource/qbo-report/parser';
import { readReportGrid } from '@/datasource/qbo-report/read';
import { prisma } from '@/lib/db';
import { recalculateAfter } from '@/lib/after-mutation';
import { getOrgId } from '@/lib/org';

const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;

function back(message: string): never {
  redirect(`/import?error=${encodeURIComponent(message)}`);
}

/**
 * Step 1 of the report import: stash the upload and send the user to a confirm
 * page that shows what was parsed. Nothing touches the mirror until they commit.
 */
export async function uploadQboReport(formData: FormData): Promise<void> {
  const upload = formData.get('report');
  const grantId = String(formData.get('grantId') ?? '').trim();
  const sheet = String(formData.get('sheet') ?? '').trim() || null;
  if (!(upload instanceof File) || upload.size === 0)
    back('Choose a QuickBooks report export (.xlsx or .csv).');
  const file: File = upload;
  if (file.size > MAX_UPLOAD_BYTES) back('The export is larger than 25 MB.');
  if (!grantId) back('Choose the grant this report belongs to.');
  const orgId = await getOrgId();
  const grant = await prisma.grant.findFirst({
    where: { id: grantId, orgId },
    select: { id: true },
  });
  if (!grant) back('That grant does not exist.');

  const content = Buffer.from(await file.arrayBuffer());
  const fileName = path.basename(file.name);
  const grid = await readReportGrid(content, fileName, { sheet }).catch((err: unknown) =>
    back(err instanceof Error ? err.message : String(err)),
  );
  const staged = await prisma.qboReportUpload.create({
    data: {
      orgId,
      grantId,
      fileName,
      sheetName: grid.sheetName,
      sha256: grid.sha256,
      content,
    },
    select: { id: true },
  });
  redirect(`/import/qbo-report/${staged.id}`);
}

/** Step 2: run the scoped import from the staged upload and go to the batch page. */
export async function commitQboReport(formData: FormData): Promise<void> {
  const uploadId = String(formData.get('uploadId') ?? '');
  const orgId = await getOrgId();
  const upload = await prisma.qboReportUpload.findFirst({
    where: { id: uploadId, orgId },
    include: { grant: { select: { id: true } } },
  });
  if (!upload) redirect(`/import?error=${encodeURIComponent('That upload has expired.')}`);
  if (upload.batchId) redirect(`/import/${upload.batchId}`);

  // Claim the upload once so a double submit cannot run two imports.
  const claimed = await prisma.qboReportUpload.updateMany({
    where: { id: upload.id, orgId, consumedAt: null },
    data: { consumedAt: new Date() },
  });
  if (claimed.count === 0) {
    redirect(
      `/import?error=${encodeURIComponent('That report is already being imported; see the latest batch below.')}`,
    );
  }

  const overrides = accountTypeOverrides(formData.entries());
  const grid = await readReportGrid(Buffer.from(upload.content), upload.fileName, {
    sheet: upload.sheetName,
  });
  const report = parseQboReport(grid.rows, { fileName: upload.fileName });
  if (!report.dateRange) redirect(`/import/qbo-report/${upload.id}`);
  const org = await prisma.org.findUniqueOrThrow({ where: { id: orgId } });
  const source = new QboReportDataSource({
    report,
    fileName: upload.fileName,
    sha256: upload.sha256,
    org: {
      companyName: org.name,
      fiscalYearStartMonth: org.fiscalYearStartMonth,
      currency: org.currency,
    },
    accountTypes: overrides,
  });
  let batchId: string;
  let succeeded = false;
  try {
    const result = await runImport(orgId, source, report.dateRange, {
      scope: {
        grantId: upload.grantId,
        dateFrom: report.dateRange.from,
        dateTo: report.dateRange.to,
      },
    });
    batchId = result.batchId;
    succeeded = result.status === 'succeeded';
  } catch (err) {
    // Nothing was recorded; hand the upload back so it can be retried.
    await prisma.qboReportUpload.update({
      where: { id: upload.id },
      data: { consumedAt: null },
    });
    throw err;
  }
  await prisma.qboReportUpload.update({ where: { id: upload.id }, data: { batchId } });
  if (succeeded) await recalculateAfter(orgId, 'QuickBooks report imported', 'import');
  redirect(`/import/${batchId}`);
}
