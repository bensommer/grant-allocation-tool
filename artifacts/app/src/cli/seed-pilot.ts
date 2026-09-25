/** pnpm seed:pilot [-- --file fixtures/pilot/seed.json] */
import 'dotenv/config';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { cliArgs } from '@/cli/args';
import { prisma } from '@/lib/db';
import { getOrgId } from '@/lib/org';
import { recompute } from '@/engine/recompute';
import { seedPilot } from '@/seed/pilot';

async function main() {
  const { values } = parseArgs({
    args: cliArgs(),
    options: { file: { type: 'string' }, 'no-recompute': { type: 'boolean' } },
  });
  const file = path.resolve(values.file ?? 'fixtures/pilot/seed.json');
  const orgId = await getOrgId();
  const summary = await seedPilot(orgId, file);
  for (const g of summary.grants) console.log(`${g.key}:`, g);
  for (const n of summary.notes) console.log(`note: ${n}`);
  if (!values['no-recompute']) {
    const run = await recompute(orgId, { actor: 'seed:pilot' });
    console.log(`recompute ${run.runId}: ${run.status}${run.error ? ` — ${run.error}` : ''}`);
    if (run.status !== 'succeeded') process.exitCode = 1;
  }
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
