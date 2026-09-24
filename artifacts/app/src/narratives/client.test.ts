import { expect, it } from 'vitest';
import { AnthropicModel, parseModelJson } from './client';
import { parseDraft } from './service';

it.skipIf(process.env.NARRATIVE_LIVE_TEST !== '1')(
  'runs one optional live model smoke test',
  async () => {
    if (!process.env.ANTHROPIC_API_KEY || !process.env.NARRATIVE_MODEL)
      throw new Error('Set ANTHROPIC_API_KEY and NARRATIVE_MODEL for the live smoke test.');
    const model = new AnthropicModel(process.env.ANTHROPIC_API_KEY, process.env.NARRATIVE_MODEL);
    const response = await model.generate(
      'Return only JSON {"sections":[{"heading":"Financial overview","body":"Spent $1.00."}]} using only the supplied packet.',
      { derived: { currency: { actual: 100 }, percentage: {} } },
    );
    expect(parseDraft(response).sections).toHaveLength(1);
  },
);

it('parses fenced or prose-wrapped JSON and leaves garbage for the zod gate', () => {
  const obj = { sections: [{ heading: 'A', body: 'B' }] };
  expect(parseModelJson(JSON.stringify(obj))).toEqual(obj);
  expect(parseModelJson('```json\n' + JSON.stringify(obj) + '\n```')).toEqual(obj);
  expect(parseModelJson('Here is the draft:\n' + JSON.stringify(obj) + '\nLet me know.')).toEqual(
    obj,
  );
  expect(parseModelJson('not json at all')).toBe('not json at all');
});
