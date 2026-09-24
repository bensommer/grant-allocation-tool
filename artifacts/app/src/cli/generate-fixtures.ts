/** npm run fixtures:generate -- --seed 42 --months 12 [--out fixtures/generated] */
import path from 'node:path';
import { parseArgs } from 'node:util';
import { cliArgs } from '@/cli/args';
import { generateFixtures } from '@/seed/generate-fixtures';

const { values } = parseArgs({
  args: cliArgs(),
  options: {
    seed: { type: 'string', default: '42' },
    months: { type: 'string', default: '12' },
    out: { type: 'string', default: 'fixtures/generated' },
  },
});
generateFixtures({
  seed: Number(values.seed),
  months: Number(values.months),
  demoDir: path.resolve('fixtures/demo'),
  outDir: path.resolve(values.out!),
}).then((r) =>
  console.log(`wrote ${r.transactions} transactions / ${r.lines} lines to ${values.out}`),
);
