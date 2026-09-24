/** npm run seed:demo [-- --dir fixtures/demo/overlay] */
import 'dotenv/config';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { cliArgs } from '@/cli/args';
import { prisma } from '@/lib/db';
import { getOrgId } from '@/lib/org';
import { seedDemoOverlay } from '@/seed/demo-overlay';

async function main() {
  const { values } = parseArgs({
    args: cliArgs(),
    options: { dir: { type: 'string' } },
  });
  const dir = path.resolve(values.dir ?? 'fixtures/demo/overlay');
  const orgId = await getOrgId();
  const counts = await seedDemoOverlay(orgId, dir);
  console.log(`seeded overlay from ${dir}:`, counts);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
