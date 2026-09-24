import Anthropic from '@anthropic-ai/sdk';
import type { NarrativeDraft } from './schema';

export interface NarrativeModel {
  readonly model: string;
  generate(prompt: string, packet: unknown): Promise<unknown>;
}

export class AnthropicModel implements NarrativeModel {
  readonly model: string;
  private client: Anthropic;
  constructor(key: string, model: string) {
    this.client = new Anthropic({ apiKey: key });
    this.model = model;
  }
  async generate(prompt: string, packet: unknown): Promise<unknown> {
    const response = await this.client.messages.create({
      model: this.model,
      max_tokens: 2048,
      messages: [
        { role: 'user', content: `${prompt}\n\nGrounding packet:\n${JSON.stringify(packet)}` },
      ],
    });
    const text = response.content
      .filter((block) => block.type === 'text')
      .map((block) => block.text)
      .join('');
    return parseModelJson(text);
  }
}

/**
 * Models often wrap JSON in a ```json fence or add a sentence around it.
 * Take the outermost {...} object; anything that still fails to parse is
 * returned as the raw string so the zod gate reports it as malformed output.
 */
export function parseModelJson(text: string): unknown {
  const unfenced = text.replace(/^\s*```(?:json)?\s*/i, '').replace(/\s*```\s*$/, '');
  const start = unfenced.indexOf('{');
  const end = unfenced.lastIndexOf('}');
  const candidate = start >= 0 && end > start ? unfenced.slice(start, end + 1) : unfenced;
  try {
    return JSON.parse(candidate);
  } catch {
    return text;
  }
}

export function narrativeModel(): NarrativeModel | null {
  if (process.env.NARRATIVE_FAKE_MODEL === '1' && process.env.NODE_ENV !== 'production')
    return {
      model: 'development-fake',
      async generate() {
        return {
          sections: [
            {
              heading: 'Spending and pace',
              body: 'Spending is over pace. The restricted balance remains available.',
            },
          ],
        };
      },
    };
  if (!process.env.ANTHROPIC_API_KEY) return null;
  if (!process.env.NARRATIVE_MODEL) throw new Error('Set NARRATIVE_MODEL to enable narratives.');
  return new AnthropicModel(process.env.ANTHROPIC_API_KEY, process.env.NARRATIVE_MODEL);
}
