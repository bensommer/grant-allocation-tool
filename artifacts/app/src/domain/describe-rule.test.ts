import { describe, expect, it } from 'vitest';
import { describeRule, suggestRuleName, type RuleLabels } from './describe-rule';

const labels: RuleLabels = {
  programs: new Map([['ym', 'Youth Meals']]),
  accounts: new Map([
    ['sp', 'Service Providers'],
    ['rent', 'Rent'],
    ['util', 'Utilities'],
  ]),
  classes: new Map(),
  locations: new Map(),
  parties: new Map([['dana', 'Dana Fairley']]),
};

describe('describeRule (JPH-26 B1)', () => {
  it('renders the ticket example sentence for a grant rule', () => {
    const d = describeRule({
      scope: { grant: 'Salah' },
      matchers: { accountIds: ['sp'], partyIds: ['dana'], descriptionContains: 'camp fee' },
      target: { kind: 'line', name: 'Dana Fairley' },
      labels,
    });
    expect(d.sentence).toBe(
      'Salah transactions where account is Service Providers AND name is Dana Fairley AND description contains "camp fee" → Dana Fairley',
    );
    expect(d.conditions).toHaveLength(3);
  });

  it('crosswalk rules read "All transactions … → grant › budget line"', () => {
    const d = describeRule({
      scope: 'all',
      matchers: { programIds: ['ym'], accountIds: ['rent'] },
      target: { kind: 'crosswalk', grant: 'Youth Meals Grant', budgetLine: 'Occupancy' },
      labels,
    });
    expect(d.sentence).toBe(
      'All transactions where program is Youth Meals AND account is Rent → Youth Meals Grant › Occupancy',
    );
  });

  it('uses "is A or B" for two items and "is any of A, B, C" for more', () => {
    const two = describeRule({
      scope: 'all',
      matchers: { accountIds: ['rent', 'util'] },
      target: null,
      labels,
    });
    expect(two.conditions).toEqual(['account is Rent or Utilities']);
    const three = describeRule({
      scope: 'all',
      matchers: { accountIds: ['sp', 'rent', 'util'] },
      target: null,
      labels,
    });
    expect(three.conditions).toEqual(['account is any of Service Providers, Rent, Utilities']);
  });

  it('empty rule → "All transactions → (choose a target)"; dimension targets are prefixed', () => {
    expect(describeRule({ scope: 'all', matchers: {}, target: null, labels }).sentence).toBe(
      'All transactions → (choose a target)',
    );
    expect(
      describeRule({
        scope: { grant: 'Opioid' },
        matchers: {},
        target: { kind: 'activity', name: 'Conference' },
        labels,
      }).sentence,
    ).toBe('Opioid transactions → activity Conference');
    expect(
      describeRule({
        scope: 'all',
        matchers: {},
        target: { kind: 'category', name: 'Food' },
        labels,
      }).target,
    ).toBe('category Food');
  });

  it('list wording keeps the pre-phase strings: "party is", " or " joins, capitalised, empty text', () => {
    const d = describeRule(
      {
        scope: 'all',
        matchers: { accountIds: ['sp', 'rent', 'util'], partyIds: ['dana'] },
        target: null,
        labels,
      },
      { wording: 'list' },
    );
    expect(d.conditionsText).toBe(
      'Account is Service Providers or Rent or Utilities AND party is Dana Fairley',
    );
    expect(
      describeRule({ scope: 'all', matchers: {}, target: null, labels }, { wording: 'list' })
        .conditionsText,
    ).toBe('every line (no conditions)');
  });

  it('suggestRuleName cuts at 80 characters', () => {
    expect(suggestRuleName('short')).toBe('short');
    const long = suggestRuleName('x'.repeat(100));
    expect(long.length).toBeLessThanOrEqual(80);
    expect(long.endsWith('…')).toBe(true);
  });
});
