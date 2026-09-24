import { mkdtemp } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { generateFixtures } from './generate-fixtures';

const demoDir = path.resolve(__dirname, '../../fixtures/demo');

describe('fixture generator', () => {
  it('is deterministic: same seed → byte-identical CSVs', async () => {
    const a = await generateFixtures({
      seed: 42,
      months: 12,
      demoDir,
      outDir: await mkdtemp(path.join(os.tmpdir(), 'gen-a-')),
    });
    const b = await generateFixtures({
      seed: 42,
      months: 12,
      demoDir,
      outDir: await mkdtemp(path.join(os.tmpdir(), 'gen-b-')),
    });
    expect(a.files).toEqual(b.files);
    expect(a.files['transactions.csv']).toBe(
      '6dd900287abc9900916cd090baaea4650e08da53edbccaff99ed419aede32c58',
    );
    const c = await generateFixtures({
      seed: 43,
      months: 12,
      demoDir,
      outDir: await mkdtemp(path.join(os.tmpdir(), 'gen-c-')),
    });
    expect(c.files['transactions.csv']).not.toBe(a.files['transactions.csv']);
  });
});
