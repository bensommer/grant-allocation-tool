import { describe, expect, it } from 'vitest';
import {
  conditionsOf,
  nearMissCondition,
  suggestAll,
  suggestFor,
  type SuggestBudgetLine,
  type SuggestContext,
  type SuggestLine,
  type SuggestRule,
} from './suggest';

const d = (iso: string) => new Date(`${iso}T00:00:00.000Z`);

const rule = (over: Partial<SuggestRule> & Pick<SuggestRule, 'id' | 'name'>): SuggestRule => ({
  dimension: 'line',
  matchers: {},
  priority: 50,
  active: true,
  targetBudgetLineId: null,
  targetActivityId: null,
  targetCategoryKey: null,
  ...over,
});

const line = (over: Partial<SuggestLine> & Pick<SuggestLine, 'id'>): SuggestLine => ({
  accountId: 'salaries',
  accountNumber: null,
  classId: null,
  locationId: null,
  partyId: 'adp',
  txnPartyId: null,
  description: 'Leah Salah time',
  memo: null,
  txnDate: d('2026-04-21'),
  programId: null,
  txnType: 'Expense',
  amountCents: 23_254,
  reason: 'no rule match',
  activityId: null,
  categoryRuleId: null,
  ...over,
});

const flatLines: SuggestBudgetLine[] = [
  { id: 'cat-culinary', kind: 'funder_category', activityId: null, categoryKey: null },
  { id: 'leah', kind: 'working_line', activityId: null, categoryKey: null },
  { id: 'kira', kind: 'working_line', activityId: null, categoryKey: null },
  { id: 'supp', kind: 'working_line', activityId: null, categoryKey: null },
  { id: 'pract', kind: 'working_line', activityId: null, categoryKey: null },
];

const labels: SuggestContext['labels'] = {
  budgetLine: (id) => ({ leah: 'Leah (Sept+)', kira: 'Kira Tanaka', supp: 'Supplies' })[id] ?? id,
  activity: (id) => ({ socials: 'Sober Socials', teen: 'Teen Monthly' })[id] ?? id,
  category: (key) => ({ PRACT: 'Practitioners', SUPPORT: 'Program Support' })[key] ?? key,
  account: (id) => ({ salaries: 'Salaries', supplies: 'Program Supplies' })[id] ?? id,
  party: (id) => ({ adp: 'ADP - Direct Deposit', dana: 'Dana Fairley' })[id] ?? id,
};

const leahRule = rule({
  id: 'r-leah',
  name: 'Leah payroll from September',
  priority: 20,
  matchers: { accountIds: ['salaries'], descriptionContainsAny: ['Leah'], dateFrom: '2026-09-01' },
  targetBudgetLineId: 'leah',
});
const kiraRule = rule({
  id: 'r-kira',
  name: 'Kira payroll',
  priority: 10,
  matchers: { accountIds: ['salaries'], descriptionContainsAny: ['Kira'] },
  targetBudgetLineId: 'kira',
});
const suppliesRule = rule({
  id: 'r-supp',
  name: 'Program supplies',
  priority: 50,
  matchers: { accountIds: ['supplies'] },
  targetBudgetLineId: 'supp',
});

const flat = (over: Partial<SuggestContext> = {}): SuggestContext => ({
  rules: [kiraRule, leahRule, suppliesRule],
  budgetLines: flatLines,
  assigned: [],
  labels,
  ...over,
});

describe('suggestFor (JPH-27 C1, AC12)', () => {
  it('near-miss rule: a pre-September Leah line is suggested to Leah (Sept+) "except the date"', () => {
    const s = suggestFor(line({ id: 'l1' }), flat());
    expect(s).toEqual({
      targetBudgetLineId: 'leah',
      confidence: 'rule',
      reason: 'Matches rule "Leah payroll from September" except the date',
      ruleId: 'r-leah',
    });
  });

  it('near-miss rule: names the one condition that missed and ignores rules that miss on two', () => {
    // Account matches, description matches, date misses → the date. Kira's rule misses on the
    // description only, but Kira's line is in-range so it fully matches Kira and is not a near miss.
    const ctx = flat();
    expect(nearMissCondition(line({ id: 'x' }), leahRule)).toBe('date');
    expect(nearMissCondition(line({ id: 'x', description: 'Kira hours' }), kiraRule)).toBeNull();
    // Wrong account and wrong date → two misses → no near miss.
    expect(
      nearMissCondition(line({ id: 'x', accountId: 'travel', txnDate: d('2026-03-01') }), leahRule),
    ).toBeNull();
    // A single-condition rule is never a near miss (dropping it would match everything).
    expect(nearMissCondition(line({ id: 'x', accountId: 'travel' }), suppliesRule)).toBeNull();
    // With no other signal the engine reason is shown.
    const none = suggestFor(
      line({ id: 'x', accountId: 'travel', description: 'flights', partyId: null }),
      ctx,
    );
    expect(none).toEqual({ confidence: null, reason: 'no rule match' });
  });

  it('near-miss rule: an inactive rule and a rule whose target left the grant are skipped', () => {
    const inactive = flat({ rules: [{ ...leahRule, active: false }] });
    expect(suggestFor(line({ id: 'l1', partyId: null }), inactive).confidence).toBeNull();
    const gone = flat({ rules: [{ ...leahRule, targetBudgetLineId: 'elsewhere' }] });
    expect(suggestFor(line({ id: 'l1', partyId: null }), gone).confidence).toBeNull();
  });

  it('name history: the same name assigned twice or more to one target suggests that target', () => {
    const ctx = flat({
      rules: [],
      assigned: [
        { partyId: 'dana', txnPartyId: null, budgetLineId: 'pract' },
        { partyId: 'dana', txnPartyId: null, budgetLineId: 'pract' },
        { partyId: 'dana', txnPartyId: null, budgetLineId: 'pract' },
        { partyId: 'dana', txnPartyId: null, budgetLineId: 'pract' },
        { partyId: 'dana', txnPartyId: null, budgetLineId: 'supp' },
        { partyId: null, txnPartyId: 'dana', budgetLineId: 'supp' },
      ],
    });
    const s = suggestFor(line({ id: 'l1', partyId: 'dana', accountId: 'services' }), ctx);
    expect(s).toEqual({
      targetBudgetLineId: 'pract',
      confidence: 'history',
      reason: 'Dana Fairley was sent here 4 times before',
    });
    // The transaction's name counts when the line has none.
    expect(
      suggestFor(line({ id: 'l2', partyId: null, txnPartyId: 'dana', accountId: 'services' }), ctx)
        .targetBudgetLineId,
    ).toBe('pract');
    // One earlier assignment is not history.
    const once = flat({
      rules: [],
      assigned: [{ partyId: 'dana', txnPartyId: null, budgetLineId: 'pract' }],
    });
    expect(suggestFor(line({ id: 'l3', partyId: 'dana' }), once).confidence).toBeNull();
  });

  it('account default: an account that maps to exactly one target across the rules', () => {
    // Program Supplies → Supplies is the only mapping; the line misses the rule on a second
    // condition (class), which is also a near miss, so give the rule two failing conditions.
    const twoConditions = rule({
      id: 'r-supp2',
      name: 'Program supplies (youth, checks)',
      matchers: { accountIds: ['supplies'], classIds: ['youth'], txnTypes: ['Check'] },
      targetBudgetLineId: 'supp',
    });
    const ctx = flat({ rules: [kiraRule, twoConditions] });
    const s = suggestFor(
      line({ id: 'l1', accountId: 'supplies', classId: 'trauma', txnType: 'Expense', partyId: null }),
      ctx,
    );
    expect(s).toEqual({
      targetBudgetLineId: 'supp',
      confidence: 'account',
      reason: 'Program Supplies always goes to Supplies',
    });
    // Salaries maps to two targets (Kira and Leah) → no default. Both rules have the account as
    // one of their conditions, so give each a second miss (class) to keep them from being near misses.
    const salaries = suggestFor(
      line({ id: 'l2', description: 'Cole hours', txnDate: d('2026-03-01'), partyId: null }),
      flat({
        rules: [
          { ...kiraRule, matchers: { ...kiraRule.matchers, classIds: ['youth'] } },
          { ...leahRule, matchers: { ...leahRule.matchers, classIds: ['youth'] } },
        ],
      }),
    );
    expect(salaries).toEqual({ confidence: null, reason: 'no rule match' });
  });

  it('near-miss rule: the rule with the most conditions satisfied wins over an earlier priority', () => {
    // Kira's rule (priority 10) misses a Leah line on its description only, with one condition
    // satisfied; Leah's rule (priority 20) misses on the date with two satisfied → Leah wins.
    expect(suggestFor(line({ id: 'l1' }), flat()).targetBudgetLineId).toBe('leah');
    // Equal closeness → priority order.
    const twin = rule({
      id: 'r-twin',
      name: 'Salaries twin',
      priority: 5,
      matchers: { accountIds: ['salaries'], descriptionContainsAny: ['nobody'] },
      targetBudgetLineId: 'supp',
    });
    const s = suggestFor(
      line({ id: 'l2', description: 'Cole hours', partyId: null }),
      flat({ rules: [kiraRule, twin] }),
    );
    expect(s.targetBudgetLineId).toBe('supp');
    expect(s.reason).toBe('Matches rule "Salaries twin" except the description');
  });

  it('half-resolved activity × category: names the matched side and asks for the other', () => {
    const cells: SuggestBudgetLine[] = [
      { id: 'c1', kind: 'cell', activityId: 'socials', categoryKey: 'PRACT' },
      { id: 'c2', kind: 'cell', activityId: 'socials', categoryKey: 'SUPPORT' },
      { id: 'c3', kind: 'cell', activityId: 'teen', categoryKey: 'PRACT' },
    ];
    const catRule = rule({
      id: 'r-cat',
      name: 'Category: practitioners',
      dimension: 'category',
      matchers: { accountIds: ['services'] },
      targetCategoryKey: 'PRACT',
    });
    const ctx = flat({ rules: [catRule], budgetLines: cells });
    expect(
      suggestFor(
        line({ id: 'l1', partyId: null, activityId: 'socials', reason: 'no category match' }),
        ctx,
      ),
    ).toEqual({
      activityId: 'socials',
      confidence: 'partial',
      reason: 'Activity matched Sober Socials; pick a category',
    });
    expect(
      suggestFor(
        line({ id: 'l2', partyId: null, categoryRuleId: 'r-cat', reason: 'no activity match' }),
        ctx,
      ),
    ).toEqual({
      categoryKey: 'PRACT',
      confidence: 'partial',
      reason: 'Category matched Practitioners; pick an activity',
    });
  });

  it('near-miss on an activity rule completes the activity × category with the matched category', () => {
    const cells: SuggestBudgetLine[] = [
      { id: 'c1', kind: 'cell', activityId: 'socials', categoryKey: 'PRACT' },
    ];
    const actRule = rule({
      id: 'r-act',
      name: 'Sober Socials',
      dimension: 'activity',
      matchers: { classIds: ['socials-class'], descriptionContainsAny: ['social'] },
      targetActivityId: 'socials',
    });
    const catRule = rule({
      id: 'r-cat',
      name: 'Category: practitioners',
      dimension: 'category',
      matchers: { accountIds: ['services'] },
      targetCategoryKey: 'PRACT',
    });
    const ctx = flat({ rules: [actRule, catRule], budgetLines: cells });
    const s = suggestFor(
      line({
        id: 'l1',
        partyId: null,
        classId: 'other',
        description: 'Sober social night',
        categoryRuleId: 'r-cat',
        reason: 'no activity match',
      }),
      ctx,
    );
    expect(s).toEqual({
      targetBudgetLineId: 'c1',
      activityId: 'socials',
      categoryKey: 'PRACT',
      confidence: 'rule',
      reason: 'Matches rule "Sober Socials" except the class',
      ruleId: 'r-act',
    });
  });

  it('none: keeps the engine reason, and suggestAll keys by line id', () => {
    const ctx = flat({ rules: [] });
    const all = suggestAll(
      [
        line({ id: 'a', partyId: null, reason: 'no budget cell' }),
        line({ id: 'b', partyId: null, reason: null }),
      ],
      ctx,
    );
    expect(all.get('a')).toEqual({ confidence: null, reason: 'no budget cell' });
    expect(all.get('b')).toEqual({ confidence: null, reason: 'needs review' });
  });

  it('conditionsOf folds dateFrom/dateTo into one date condition and ignores empty values', () => {
    expect(
      conditionsOf({ accountIds: ['a'], dateFrom: '2026-01-01', dateTo: '2026-12-31', classIds: [] }),
    ).toEqual(['accountIds', 'date']);
  });
});
