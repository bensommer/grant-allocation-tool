import { readFile } from 'node:fs/promises';

export const templates = {
  'Quarterly financial narrative': 'quarterly',
  'Final grant close-out summary': 'closeout',
  'Budget modification justification': 'modification',
} as const;
export type Template = keyof typeof templates;
export const promptVersion = 'v1';
export async function promptFor(template: Template) {
  return readFile(new URL(`./${templates[template]}.v1.md`, import.meta.url), 'utf8');
}
