import { parseMoneyToCents } from '@/domain/money';

export type NumberToken = {
  text: string;
  kind: 'currency' | 'percentage';
  value: number;
  start: number;
  end: number;
};
// Prefer a whole parenthesized amount only when ')' immediately follows the number.
// Otherwise the parenthesis is ordinary prose and the inner amount is positive.
// Plain years, dates and unmarked integer counts are not treated as currencies.
const numberPattern =
  /(?<![\w/,.-])(?:\(\s*\$?(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?\)|-?(?:\$|USD\s+)(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?|-?(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?\s+dollars?\b|-?(?:\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d+\.\d+))(?:%|(?![\w/%]|,\d|\.\d))|-?\d+(?:\.\d+)?%/gi;

export function extractNumbers(text: string): NumberToken[] {
  return [...text.matchAll(numberPattern)].map((match) => {
    const raw = match[0];
    const kind = raw.endsWith('%') ? 'percentage' : 'currency';
    return {
      text: raw,
      kind,
      value: kind === 'percentage' ? Number(raw.slice(0, -1)) : parseCurrency(raw),
      start: match.index,
      end: match.index + raw.length,
    };
  });
}

function parseCurrency(raw: string): number {
  const amount = raw
    .replace(/^(-?)USD\s+/i, '$1')
    .replace(/\s+dollars?$/i, '')
    .replace(/\s/g, '');
  try {
    return parseMoneyToCents(amount);
  } catch {
    // Preserve the complete malformed token so verification rejects it rather than
    // silently accepting a valid prefix (e.g. "$1,234.567" as "$1,234.56").
    return NaN;
  }
}
