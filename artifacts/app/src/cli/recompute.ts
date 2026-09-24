/** npm run recompute — run the allocation pipeline once and print the summary. */
import 'dotenv/config';
import { prisma } from '@/lib/db';
import { getOrgId } from '@/lib/org';
import { recompute } from '@/engine/recompute';

async function main() {
  const orgId = await getOrgId();
  const r = await recompute(orgId);
  console.log(r);
  if (r.status !== 'succeeded') process.exitCode = 1;
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
