import { describe, expect, it } from 'vitest';
import {
  codeFromName,
  linesFromCategories,
  parseAward,
  parseBudget,
  parseLines,
  parsePastedBudget,
  ruleChoices,
  wizardStep,
} from './grant-draft';

describe('wizard step numbers', () => {
  it('accepts 1–5 only', () => {
    expect(wizardStep('1')).toBe(1);
    expect(wizardStep('5')).toBe(5);
    expect(wizardStep('0')).toBeNull();
    expect(wizardStep('6')).toBeNull();
    expect(wizardStep('two')).toBeNull();
    expect(wizardStep(undefined)).toBeNull();
  });
});

describe('step 1 — the award', () => {
  const good = {
    name: 'Salah Foundation — Trauma Programs',
    funderText: 'Salah Foundation',
    awardAmount: '50,000.00',
    startDate: '2026-03-13',
    endDate: '2027-02-28',
    restrictionType: 'purpose',
  };
  it('parses a complete award into integer cents and dates', () => {
    const r = parseAward(good);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.data.awardAmountCents).toBe(5_000_000);
    expect(r.data.awardNumber).toBeNull();
    expect(r.data.startDate.toISOString().slice(0, 10)).toBe('2026-03-13');
  });
  it('names every missing or malformed field', () => {
    const r = parseAward({ ...good, name: '', awardAmount: 'lots', endDate: '2025-01-01' });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(Object.keys(r.errors).sort()).toEqual(['awardAmount', 'endDate', 'name']);
  });
});

describe('step 3 — pasting two columns', () => {
  it('reads tab, double-space and comma separated rows, with an optional code column', () => {
    expect(
      parsePastedBudget(
        'Personnel\t80,000.00\nSupplies  12,500\nTravel, 1,200.50\nFAC\tFacilitators\t29,400',
      ),
    ).toEqual([
      { code: '', name: 'Personnel', amount: '80,000.00' },
      { code: '', name: 'Supplies', amount: '12,500' },
      { code: '', name: 'Travel', amount: '1,200.50' },
      { code: 'FAC', name: 'Facilitators', amount: '29,400' },
    ]);
  });
  it('keeps a name without an amount so the user can fill it in', () => {
    expect(parsePastedBudget('Personnel\n\n')).toEqual([
      { code: '', name: 'Personnel', amount: '' },
    ]);
  });
});

describe('step 3 — funder categories', () => {
  it('derives unique upper-case codes from names and ignores blank rows', () => {
    const r = parseBudget({
      catCode: ['', '', 'SUPP', ''],
      catName: ['Food & Beverage', 'Food & Beverage', 'Supplies', ''],
      catAmount: ['929.62', '1,000', '5,493.10', ''],
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.data).toEqual([
      { code: 'FOODBEVERAGE', name: 'Food & Beverage', budgetCents: 92_962 },
      { code: 'FOODBEVERAG2', name: 'Food & Beverage', budgetCents: 100_000 },
      { code: 'SUPP', name: 'Supplies', budgetCents: 549_310 },
    ]);
  });
  it('rejects duplicate codes, bad amounts and an empty budget', () => {
    expect(parseBudget({})).toEqual({
      ok: false,
      errors: { _: 'Add at least one funder category' },
    });
    const r = parseBudget({ catCode: ['A', 'A'], catName: ['x', 'y'], catAmount: ['1', 'one'] });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.errors).toMatchObject({
      catCode_1: 'Code A is used twice',
      catAmount_1: expect.any(String),
    });
  });
  it('codeFromName never collides with a taken code', () => {
    const taken = new Set(['SUPPLIES']);
    expect(codeFromName('Supplies', taken)).toBe('SUPPLIES2');
    expect(codeFromName('Supplies', taken)).toBe('SUPPLIES3');
    expect(codeFromName('***', taken)).toBe('LINE');
  });
});

describe('step 4 — working lines', () => {
  const categories = [
    { code: 'FAC', name: 'Facilitators', budgetCents: 2_940_000 },
    { code: 'FOODBEV', name: 'Food & Beverage', budgetCents: 500_000 },
  ];
  it('"No" makes one working line per category with the category amount', () => {
    expect(linesFromCategories(categories)).toEqual([
      { code: 'FACILITATORS', name: 'Facilitators', budgetCents: 2_940_000, category: 0 },
      { code: 'FOODBEVERAGE', name: 'Food & Beverage', budgetCents: 500_000, category: 1 },
    ]);
  });
  it('"Yes" nests posted rows under their category and requires one per category', () => {
    const r = parseLines(
      {
        lineCat: ['0', '0', '1', '1'],
        lineCode: ['KIRA', '', '', ''],
        lineName: ['Kira Tanaka', 'Practitioners', 'Food', ''],
        lineAmount: ['9,262', '12,496', '5,000.60', ''],
      },
      categories,
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.data.map((l) => [l.code, l.category, l.budgetCents])).toEqual([
      ['KIRA', 0, 926_200],
      ['PRACTITIONER', 0, 1_249_600],
      ['FOOD', 1, 500_060],
    ]);
    const missing = parseLines(
      { lineCat: ['0'], lineName: ['Only one'], lineAmount: ['1'] },
      categories,
    );
    expect(missing.ok).toBe(false);
    if (missing.ok) return;
    expect(missing.errors['_']).toContain('Food & Beverage has none');
  });
});

describe('step 5 — rule choices', () => {
  it('reads rule_<key> fields only', () => {
    expect([...ruleChoices({ 'rule_acc1|': 'KIRA', 'rule_acc1|p1': 'later', other: 'x' })]).toEqual(
      [
        ['acc1|', 'KIRA'],
        ['acc1|p1', 'later'],
      ],
    );
  });
});
