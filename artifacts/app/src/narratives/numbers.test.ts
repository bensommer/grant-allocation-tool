import { describe, expect, it } from 'vitest';
import { extractNumbers } from './numbers';
import { verifyDraft } from './verify';
import type { GroundingPacket } from './packet';

describe('narrative number extraction', () => {
  it('extracts signed and parenthesized amounts and percentages, not dates', () => {
    expect(
      extractNumbers('Spent $1,234.56, (1,234.56), -$8.50, 34.4% in 2026-03-31').map(
        ({ kind, value }) => [kind, value],
      ),
    ).toEqual([
      ['currency', 123456],
      ['currency', -123456],
      ['currency', -850],
      ['percentage', 34.4],
    ]);
  });
  it('treats prose parentheses as positive and an immediately closed amount as negative', () => {
    expect(
      extractNumbers('Salary ($5,000.00 monthly) versus ($5,000.00) or (5,000.00).').map(
        ({ text, value }) => [text, value],
      ),
    ).toEqual([
      ['$5,000.00', 500000],
      ['($5,000.00)', -500000],
      ['(5,000.00)', -500000],
    ]);
    const packet = {
      derived: { currency: { salary: 500000 }, percentage: {} },
    } as unknown as GroundingPacket;
    expect(
      verifyDraft(
        {
          sections: [{ heading: 'Payroll', body: 'Salary ($5,000.00 monthly); loss ($5,000.00).' }],
        },
        packet,
      ).map((v) => v.matched),
    ).toEqual([true, false]);
  });
  it('extracts labeled whole-dollar amounts without treating years or counts as currency', () => {
    expect(
      extractNumbers('5000 dollars, 5,000 dollars, USD 5,000; 2026-03-31, 2026, 3 programs.').map(
        ({ text, value }) => [text, value],
      ),
    ).toEqual([
      ['5000 dollars', 500000],
      ['5,000 dollars', 500000],
      ['USD 5,000', 500000],
    ]);
  });
  it('keeps a malformed-precision amount whole and fails closed', () => {
    const tokens = extractNumbers('Claimed $1,234.567 against $1,234.56.');
    expect(tokens.map((v) => v.text)).toEqual(['$1,234.567', '$1,234.56']);
    const packet = {
      derived: { currency: { actual: 123456 }, percentage: {} },
    } as unknown as GroundingPacket;
    expect(
      verifyDraft(
        { sections: [{ heading: 'Claim', body: 'Claimed $1,234.567 against $1,234.56.' }] },
        packet,
      ).map((v) => v.matched),
    ).toEqual([false, true]);
  });
  it('verifies derived figures within cent and tenth-point tolerances', () => {
    const packet = {
      derived: {
        currency: { 'itd.balance': 2024709, 'period.total.actual': 3975291 },
        percentage: { 'itd.pace.variancePct': 34.4 },
      },
    } as unknown as GroundingPacket;
    const verification = verifyDraft(
      {
        sections: [
          {
            heading: 'Spending',
            body: 'Spent 39,752.91, restricted balance $20,247.09, variance 34.4%; invented $41,000.',
          },
        ],
      },
      packet,
    );
    expect(verification.map((v) => v.matched)).toEqual([true, true, true, false]);
    expect(verification[1]?.matchedKey).toBe('itd.balance');
  });
});
