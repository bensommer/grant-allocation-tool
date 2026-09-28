/**
 * JPH-26 B2/B5 unit tests for the pure parts of the builder: prefill from query params,
 * the live sentence and the name suggestion.
 */
import { describe, expect, it } from 'vitest';
import { emptyRuleValues } from '@/lib/rule-form';
import { describeValues } from './describe';
import { prefillValues } from './prefill';
import type { BuilderOptions } from './types';

const options: BuilderOptions = {
  grants: [{ id: 'g1', name: 'Youth Meals Grant', lines: [{ id: 'bl1', label: 'MEALS — Meals' }] }],
  lines: [{ id: 'wl1', label: 'DANA — Dana Fairley' }],
  activities: [{ id: 'act1', label: 'Outreach' }],
  categories: [{ id: 'PERS', label: 'Personnel' }],
  programs: [{ id: 'p1', label: 'Youth Meals (YM)', name: 'Youth Meals' }],
  accounts: [
    { id: 'a1', label: 'Rent 6210', name: 'Rent', expense: true },
    { id: 'a2', label: 'Service Providers', expense: true },
    { id: 'bank', label: 'Checking 1000', name: 'Checking', expense: false },
  ],
  classes: [{ id: 'c1', label: 'Admin' }],
  locations: [],
  parties: [{ id: 'dana', label: 'Dana Fairley' }],
  txnTypes: ['Check'],
};

describe('prefillValues (B5)', () => {
  it('crosswalk: programId + accountId become two conditions; unknown ids are ignored', () => {
    const v = prefillValues('crosswalk', options, { programId: 'p1', accountId: 'a1' });
    expect(v?.programIds).toEqual(['p1']);
    expect(v?.accountIds).toEqual(['a1']);
    expect(v?.grantBudgetLineId).toBe('');
    expect(prefillValues('crosswalk', options, { programId: 'nope' })?.programIds).toEqual([]);
    expect(prefillValues('crosswalk', options, {})).toBeNull();
  });

  it('grant: partyId + accountId + targetBudgetLineId set the target and both conditions', () => {
    const v = prefillValues('grant', options, {
      partyId: 'dana',
      accountId: 'a2',
      targetBudgetLineId: 'wl1',
    });
    expect(v).toMatchObject({
      dimension: 'line',
      grantBudgetLineId: 'wl1',
      accountIds: ['a2'],
      partyIds: ['dana'],
      programIds: [],
    });
  });

  it('grant: activityId / categoryKey / decides pick the dimension', () => {
    expect(prefillValues('grant', options, { activityId: 'act1' })).toMatchObject({
      dimension: 'activity',
      targetActivityId: 'act1',
    });
    expect(prefillValues('grant', options, { categoryKey: 'PERS' })).toMatchObject({
      dimension: 'category',
      targetCategoryKey: 'PERS',
    });
    expect(prefillValues('grant', options, { decides: 'category' })?.dimension).toBe('category');
    expect(
      prefillValues('grant', options, { classId: 'c1', descriptionContains: ' camp fee ' }),
    ).toMatchObject({ classIds: ['c1'], descriptionContains: 'camp fee' });
  });

  it('grant rules never take a programId', () => {
    expect(prefillValues('grant', options, { programId: 'p1' })).toBeNull();
  });
});

describe('describeValues (B2 sentence + name suggestion)', () => {
  it('empty form reads "All transactions → (choose a target)" and suggests no name', () => {
    const d = describeValues(emptyRuleValues('crosswalk'), 'crosswalk', options);
    expect(d.sentence).toBe('All transactions → (choose a target)');
    expect(d.suggestedName).toBe('');
  });

  it('grant rule with Service Providers and Dana Fairley reads the ticket sentence', () => {
    const v = {
      ...emptyRuleValues('grant'),
      grantBudgetLineId: 'wl1',
      accountIds: ['a2'],
      partyIds: ['dana'],
    };
    const d = describeValues(v, 'grant', options, 'Salah');
    expect(d.sentence).toBe(
      'Salah transactions where account is Service Providers AND name is Dana Fairley → Dana Fairley',
    );
    // 95 characters: the suggestion is the sentence cut to 80 with an ellipsis.
    expect(d.suggestedName).toBe(`${d.sentence.slice(0, 79).trimEnd()}…`);
    expect(d.suggestedName.length).toBeLessThanOrEqual(80);
  });

  it('crosswalk target is grant › budget line and the suggested name is capped at 80 chars', () => {
    const v = {
      ...emptyRuleValues('crosswalk'),
      grantBudgetLineId: 'bl1',
      programIds: ['p1'],
      accountIds: ['a1', 'a2', 'bank'],
      descriptionContains: 'quarterly kitchen lease payment for the downtown site',
    };
    const d = describeValues(v, 'crosswalk', options);
    expect(
      d.sentence.startsWith(
        'All transactions where program is Youth Meals AND account is any of Rent, Service Providers, Checking',
      ),
    ).toBe(true);
    expect(d.sentence.endsWith('→ Youth Meals Grant › Meals')).toBe(true);
    expect(d.suggestedName.length).toBeLessThanOrEqual(80);
  });
});
