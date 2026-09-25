/**
 * pnpm parity:report [-- --from 2026-01-01 --to 2026-09-22]
 *
 * Reads the private workbook and `fixtures/private/parity-map.json`, asks the
 * app for each mapped metric and writes `fixtures/private/parity.md`. Skips
 * cleanly when the private files are absent; refuses to write anywhere git
 * tracks. Nothing from the workbook is printed.
 */
import 'dotenv/config';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { cliArgs } from '@/cli/args';
import { parseDateInput, toISODate } from '@/domain/dates';
import { prisma } from '@/lib/db';
import { getOrgId } from '@/lib/org';
import { runParityReport } from '@/reports/parity';
import { createMetricResolver } from '@/services/parity-metrics';

const PRIVATE_DIR = path.resolve('fixtures/private');

async function main() {
  const { values } = parseArgs({
    args: cliArgs(),
    options: {
      workbook: { type: 'string' },
      map: { type: 'string' },
      out: { type: 'string' },
      seed: { type: 'string' },
      from: { type: 'string' },
      to: { type: 'string' },
    },
  });
  const workbookPath = path.resolve(values.workbook ?? path.join(PRIVATE_DIR, 'Restricted Grants 9.21.xlsx'));
  const mapPath = path.resolve(values.map ?? path.join(PRIVATE_DIR, 'parity-map.json'));
  const outPath = path.resolve(values.out ?? path.join(PRIVATE_DIR, 'parity.md'));
  const from = parseDateInput(values.from ?? '2026-01-01');
  const to = parseDateInput(values.to ?? '2026-09-22');

  const orgId = await getOrgId();
  // Seed keys → grant ids, by the names the seed gave them.
  const seed = JSON.parse(readFileSync(path.resolve(values.seed ?? 'fixtures/pilot/seed.json'), 'utf8')) as {
    grants: Array<{ key: string; name: string }>;
  };
  const grantIds: Record<string, string> = {};
  for (const g of seed.grants) {
    const row = await prisma.grant.findFirst({ where: { orgId, name: g.name }, select: { id: true } });
    if (row) grantIds[g.key] = row.id;
  }
  const run = await prisma.computeRun.findFirst({ where: { orgId, isCurrent: true }, select: { id: true } });

  const result = await runParityReport({
    repoDir: path.resolve('.'),
    workbookPath,
    mapPath,
    outPath,
    resolve: createMetricResolver(orgId, grantIds, { from, to }),
    meta: { range: { from: toISODate(from), to: toISODate(to) }, runId: run?.id ?? null },
  });
  if (result.status === 'skipped') {
    console.log(`parity report skipped: ${result.reason}`);
    return;
  }
  const ties = result.lines.filter((l) => l.differenceCents === 0).length;
  console.log(
    `parity report written: ${path.relative('.', result.outPath)} (${result.lines.length} rows, ${ties} tie exactly)`,
  );
}

main()
  .catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
