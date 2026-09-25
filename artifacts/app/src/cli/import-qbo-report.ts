/**
 * Import a QuickBooks "Transaction Detail by Account" export into one grant.
 *
 *   pnpm import:qbo-report -- --file fixtures/pilot/salah-export.csv --grant <grantId|grant name>
 *        [--sheet "Salah Costs"] [--account-type "Contributed income=Income"]...
 */
import 'dotenv/config';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { cliArgs } from '@/cli/args';
import { QboReportDataSource } from '@/datasource/qbo-report/adapter';
import { parseQboReport } from '@/datasource/qbo-report/parser';
import { readReportGrid } from '@/datasource/qbo-report/read';
import { runImport } from '@/datasource/import-service';
import { accountTypeSchema, type AccountTypeDto } from '@/datasource/types';
import { toISODate } from '@/domain/dates';
import { prisma } from '@/lib/db';
import { getOrgId } from '@/lib/org';

async function main() {
  const { values } = parseArgs({
    args: cliArgs(),
    options: {
      file: { type: 'string' },
      grant: { type: 'string' },
      sheet: { type: 'string' },
      'account-type': { type: 'string', multiple: true },
    },
  });
  if (!values.file || !values.grant) {
    console.error(
      'usage: import:qbo-report -- --file <export.xlsx|csv> --grant <id or name> [--sheet name] [--account-type "Heading=Income"]',
    );
    process.exit(2);
  }
  const accountTypes: Record<string, AccountTypeDto> = {};
  for (const spec of values['account-type'] ?? []) {
    const eq = spec.lastIndexOf('=');
    const type = accountTypeSchema.parse(spec.slice(eq + 1));
    accountTypes[spec.slice(0, eq)] = type;
  }
  const orgId = await getOrgId();
  const grant = await prisma.grant.findFirst({
    where: { orgId, OR: [{ id: values.grant }, { name: values.grant }] },
  });
  if (!grant) {
    console.error(`grant "${values.grant}" not found`);
    process.exit(2);
  }
  const org = await prisma.org.findUniqueOrThrow({ where: { id: orgId } });
  const file = path.resolve(values.file);
  const fileName = path.basename(file);
  const grid = await readReportGrid(readFileSync(file), fileName, { sheet: values.sheet });
  const report = parseQboReport(grid.rows, { fileName });
  if (!report.dateRange) {
    console.error('The export has no recognizable date range in its title rows.');
    for (const e of report.errors) console.error(`  ${e.row ?? '-'} ${e.code}: ${e.message}`);
    process.exit(1);
  }
  const source = new QboReportDataSource({
    report,
    fileName,
    sha256: grid.sha256,
    org: {
      companyName: org.name,
      fiscalYearStartMonth: org.fiscalYearStartMonth,
      currency: org.currency,
    },
    accountTypes,
  });
  const result = await runImport(orgId, source, report.dateRange, {
    scope: { grantId: grant.id, dateFrom: report.dateRange.from, dateTo: report.dateRange.to },
  });
  console.log(
    `batch ${result.batchId}: ${result.status} (${grant.name}, ${toISODate(report.dateRange.from)}..${toISODate(report.dateRange.to)})`,
  );
  if (result.status === 'succeeded') {
    for (const [entity, c] of Object.entries(result.counts)) {
      if (typeof c === 'number') console.log(`  ${entity}: ${c}`);
      else
        console.log(
          `  ${entity}: new ${c.new}, changed ${c.changed}, unchanged ${c.unchanged}, deleted ${c.deleted}`,
        );
    }
  } else {
    for (const e of result.errors) {
      console.log(`  ${e.file}:${e.row ?? '-'} [${e.column ?? '-'}] ${e.code}: ${e.message}`);
    }
    process.exitCode = 1;
  }
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
