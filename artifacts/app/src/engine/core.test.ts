import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { allocate, findImbalances, type EngineConfig, type EngineLine } from './core';

const d = (s: string) => new Date(`${s}T00:00:00Z`);
const line = (over: Partial<EngineLine> = {}): EngineLine => ({
  id: 'L1',
  accountId: 'A6210',
  accountNumber: '6210',
  accountKind: 'expense',
  classId: 'C-ADMIN',
  locationId: null,
  partyId: null,
  txnPartyId: null,
  description: null,
  memo: null,
  txnDate: d('2026-03-01'),
  amountCents: 60001,
  ...over,
});
const base = (over: Partial<EngineConfig> = {}): EngineConfig => ({
  programs: [
    { id: 'CT', matchClassIds: ['C-CT'], active: true },
    { id: 'YM', matchClassIds: ['C-YM'], active: true },
    { id: 'MG', matchClassIds: ['C-ADMIN'], active: true },
  ],
  allocationRules: [],
  crosswalkRules: [],
  budgetLines: [],
  grants: [],
  driverValues: new Map(),
  ...over,
});
const occ = (
  id: string,
  priority: number,
  over: Partial<EngineConfig['allocationRules'][number]> = {},
) => ({
  id,
  matchers: { classIds: ['C-ADMIN'], accountIds: ['A6210', 'A6220'] },
  method: 'fixed_pct' as const,
  driverKey: null,
  priority,
  effectiveFrom: null,
  effectiveTo: null,
  active: true,
  targets: [
    { sortOrder: 0, programId: 'CT', grantBudgetLineId: null, shareBps: 5000 },
    { sortOrder: 1, programId: 'YM', grantBudgetLineId: null, shareBps: 2000 },
    { sortOrder: 2, programId: 'MG', grantBudgetLineId: null, shareBps: 3000 },
  ],
  ...over,
});

describe('engine core', () => {
  it('reproduces the March utilities rounding: 600.01 → CT 300.01 / YM 120.00 / MG 180.00', () => {
    const r = allocate([line()], base({ allocationRules: [occ('AR-OCC', 20)] }));
    expect(r.pieces.map((p) => [p.programId, p.amountCents])).toEqual([
      ['CT', 30001],
      ['YM', 12000],
      ['MG', 18000],
    ]);
    expect(r.pieces.every((p) => p.status === 'ok' && p.allocationRuleId === 'AR-OCC')).toBe(true);
  });

  it('lowest priority wins; a tie is a conflict that falls through to the class default', () => {
    const win = allocate([line()], base({ allocationRules: [occ('A', 20), occ('B', 10)] }));
    expect(win.pieces.every((p) => p.allocationRuleId === 'B')).toBe(true);
    const tie = allocate([line()], base({ allocationRules: [occ('A', 10), occ('B', 10)] }));
    expect(tie.pieces).toHaveLength(1);
    expect(tie.pieces[0]).toMatchObject({
      programId: 'MG',
      amountCents: 60001,
      status: 'allocation_conflict',
      conflictRuleIds: ['A', 'B'],
    });
    expect(tie.warnings[0]?.code).toBe('allocation_conflict');
  });

  it('effective-date windows: a rule effective from 2026-02-01 does not touch January lines', () => {
    const cfg = base({ allocationRules: [occ('AR', 10, { effectiveFrom: d('2026-02-01') })] });
    const jan = allocate([line({ txnDate: d('2026-01-15') })], cfg);
    expect(jan.pieces).toEqual([
      expect.objectContaining({ programId: 'MG', allocationRuleId: null, amountCents: 60001 }),
    ]);
    const feb = allocate([line({ txnDate: d('2026-02-01') })], cfg);
    expect(feb.pieces).toHaveLength(3);
  });

  it('lines with no class default are flagged unassigned_program', () => {
    const r = allocate([line({ classId: null })], base());
    expect(r.pieces[0]).toMatchObject({ programId: null, status: 'unassigned_program' });
  });

  it('ratio_of_driver splits by the period driver values and falls through when missing', () => {
    const rule = occ('DRV', 10, {
      method: 'ratio_of_driver',
      driverKey: 'sqft',
      targets: occ('x', 0).targets.map((t) => ({ ...t, shareBps: 0 })),
    });
    const cfg = base({
      allocationRules: [rule],
      driverValues: new Map([
        ['sqft|2026-03|CT', 600],
        ['sqft|2026-03|YM', 200],
        ['sqft|2026-03|MG', 200],
      ]),
    });
    expect(allocate([line({ amountCents: 100000 })], cfg).pieces.map((p) => p.amountCents)).toEqual(
      [60000, 20000, 20000],
    );
    const april = allocate([line({ txnDate: d('2026-04-01') })], cfg);
    expect(april.pieces).toHaveLength(1);
    expect(april.warnings[0]?.code).toBe('driver_missing');
  });

  it('crosswalk: matches on allocated program + account within the grant period; ties conflict; no match is unmapped', () => {
    const grants = [
      { id: 'G', startDate: d('2026-01-01'), endDate: d('2026-12-31'), status: 'active' as const },
    ];
    const budgetLines = [{ id: 'OCC', grantId: 'G', programId: 'CT' }];
    const xw = (id: string, priority: number) => ({
      id,
      matchers: { programIds: ['CT'], accountIds: ['A6210', 'A6220'] },
      grantBudgetLineId: 'OCC',
      priority,
      active: true,
    });
    const cfg = base({
      allocationRules: [occ('AR-OCC', 20)],
      grants,
      budgetLines,
      crosswalkRules: [xw('X1', 10)],
    });
    const r = allocate([line()], cfg);
    expect(r.pieces.find((p) => p.programId === 'CT')).toMatchObject({
      grantId: 'G',
      grantBudgetLineId: 'OCC',
      crosswalkRuleId: 'X1',
      status: 'ok',
    });
    expect(r.pieces.filter((p) => p.programId !== 'CT').every((p) => p.grantId === null)).toBe(
      true,
    );
    expect(r.stats.unmapped).toBe(2);

    const tie = allocate([line()], { ...cfg, crosswalkRules: [xw('X1', 10), xw('X2', 10)] });
    expect(tie.pieces.find((p) => p.programId === 'CT')).toMatchObject({
      grantId: null,
      status: 'crosswalk_conflict',
      conflictRuleIds: ['X1', 'X2'],
    });

    const out = allocate([line({ txnDate: d('2027-01-05') })], cfg);
    expect(out.pieces.find((p) => p.programId === 'CT')?.grantId).toBeNull();
  });

  it('explicit budget-line targets bypass crosswalk and carry the grant', () => {
    const cfg = base({
      grants: [{ id: 'G', startDate: d('2026-01-01'), endDate: d('2026-12-31'), status: 'active' }],
      budgetLines: [{ id: 'BL', grantId: 'G', programId: 'CT' }],
      allocationRules: [
        occ('AR', 10, {
          targets: [
            { sortOrder: 0, programId: null, grantBudgetLineId: 'BL', shareBps: 5000 },
            { sortOrder: 1, programId: 'MG', grantBudgetLineId: null, shareBps: 5000 },
          ],
        }),
      ],
    });
    const r = allocate([line({ amountCents: 1001 })], cfg);
    expect(r.pieces[0]).toMatchObject({
      programId: 'CT',
      grantId: 'G',
      grantBudgetLineId: 'BL',
      amountCents: 501,
      crosswalkRuleId: null,
    });
    expect(r.pieces[1]).toMatchObject({ programId: 'MG', grantId: null, amountCents: 500 });
  });

  it('property: any amount × any bps vector summing to 10000 allocates exactly', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: -5_000_000_00, max: 5_000_000_00 }),
        fc.array(fc.integer({ min: 0, max: 10000 }), { minLength: 1, maxLength: 8 }),
        (amount, raw) => {
          const total = raw.reduce((a, b) => a + b, 0);
          if (total === 0) return;
          // normalise to exactly 10000 bps
          const bps = raw.map((w) => Math.floor((w * 10000) / total));
          bps[0]! += 10000 - bps.reduce((a, b) => a + b, 0);
          const targets = bps.map((shareBps, i) => ({
            sortOrder: i,
            programId: `P${i}`,
            grantBudgetLineId: null,
            shareBps,
          }));
          const programs = targets.map((t) => ({
            id: t.programId!,
            matchClassIds: [],
            active: true,
          }));
          const lines = [line({ amountCents: amount })];
          const r = allocate(
            lines,
            base({ programs, allocationRules: [occ('R', 1, { targets })] }),
          );
          expect(findImbalances(lines, r.pieces)).toEqual([]);
          expect(r.pieces).toHaveLength(targets.length);
        },
      ),
      { numRuns: 500 },
    );
  });
});
