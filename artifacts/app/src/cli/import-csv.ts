/**
 * npm run import:csv -- --dir ./fixtures/demo [--from YYYY-MM-DD --to YYYY-MM-DD]
 */
import 'dotenv/config';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { cliArgs } from '@/cli/args';
import { CsvDataSource } from '@/datasource/csv/adapter';
import { FULL_RANGE, runImport } from '@/datasource/import-service';
import { parseDateInput } from '@/domain/dates';
import { prisma } from '@/lib/db';
import { getOrgId } from '@/lib/org';

async function main() {
  const { values } = parseArgs({
    args: cliArgs(),
    options: { dir: { type: 'string' }, from: { type: 'string' }, to: { type: 'string' } },
  });
  if (!values.dir) {
    console.error('usage: import:csv -- --dir <folder> [--from YYYY-MM-DD] [--to YYYY-MM-DD]');
    process.exit(2);
  }
  const dir = path.resolve(values.dir);
  const range = {
    from: values.from ? parseDateInput(values.from) : FULL_RANGE.from,
    to: values.to ? parseDateInput(values.to) : FULL_RANGE.to,
  };
  const orgId = await getOrgId();
  const source = new CsvDataSource({ dir });
  const result = await runImport(orgId, source, range, { fullRange: !values.from && !values.to });
  console.log(`batch ${result.batchId}: ${result.status}`);
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
