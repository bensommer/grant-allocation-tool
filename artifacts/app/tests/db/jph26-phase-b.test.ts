/**
 * JPH-26 Phase B — engine-level acceptance tests on the real seeds.
 *
 *   AC2  matchers JSON is identical whichever way the form arrives (FormData / bounced state /
 *        in-memory values) — the no-JS and JS submissions share one reader.
 *   AC4  new rules save with priority 50 when untouched; existing rules keep their stored value.
 *   AC5  superset warning for a new crosswalk rule matching everything G-MWSC/PERS matches,
 *        none for a disjoint rule.
 *   AC6  golden previews: Youth Meals × Rent → 3 · 180,000 cents; Salah Service Providers ×
 *        Dana Fairley → the engine's real count · 27,500 cents (see QUESTIONS.md).
 *   AC8  full-engine equality: AllocatedLine totals per budget line (demo) and GrantLineResult
 *        totals per working line (pilot) equal the baseline captured before this phase.
 */
import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { parseMatchers } from '@/domain/matchers';
import { prisma } from '@/lib/db';
import { lastImportedTransactionDate } from '@/services/grant-figures';
import { defaultRange, resolveAsOf, type DateRange } from '@/domain/period';
import {
  DEFAULT_NEW_PRIORITY,
  emptyRuleValues,
  formDataReader,
  formStateReader,
  matchersFromValues,
  readRuleValues,
  valuesReader,
  type RuleFormValues,
} from '@/lib/rule-form';
import { parseRuleForm } from '@/lib/rule-form-parse';
import { previewRuleForm } from '@/services/rule-preview';
import { supersetMessage } from '@/services/rule-superset';
import { createCrosswalkRule, updateCrosswalkRule } from '@/services/crosswalk';
import {
  BASELINE_FILE,
  demoAllocated,
  pilotGrantLines,
  seedDemo,
  seedPilotOrg,
  type Baseline,
} from './jph26-baseline';

const baseline = JSON.parse(readFileSync(BASELINE_FILE, 'utf8')) as Baseline;

/** The app period as a page with no `?asOf=` and no cookie would resolve it (src/lib/period.ts). */
async function appRange(orgId: string): Promise<DateRange> {
  const org = await prisma.org.findUniqueOrThrow({
    where: { id: orgId },
    select: { fiscalYearStartMonth: true },
  });
  const periodOrg = {
    fiscalYearStartMonth: org.fiscalYearStartMonth,
    booksThrough: await lastImportedTransactionDate(orgId),
  };
  return defaultRange(resolveAsOf({}, undefined, periodOrg).date, periodOrg);
}

async function id(model: 'program' | 'account' | 'party', orgId: string, where: object) {
  const row =
    model === 'program'
      ? await prisma.program.findFirst({ where: { orgId, ...where }, select: { id: true } })
      : model === 'account'
        ? await prisma.account.findFirst({ where: { orgId, ...where }, select: { id: true } })
        : await prisma.party.findFirst({ where: { orgId, ...where }, select: { id: true } });
  if (!row) throw new Error(`${model} ${JSON.stringify(where)} not seeded`);
  return row.id;
}

function toFormData(v: RuleFormValues): FormData {
  const fd = new FormData();
  for (const [k, val] of Object.entries(v)) {
    if (Array.isArray(val)) for (const x of val) fd.append(k, x);
    else if (typeof val === 'boolean') {
      if (val) fd.set(k, 'on');
    } else fd.set(k, val);
  }
  return fd;
}

describe('JPH-26 demo seed (JPH-7)', () => {
  let orgId: string;
  let ym: string;
  let ct: string;
  let rent: string;
  let salaries: string;
  let payrollTaxes: string;
  let persLine: string;

  beforeAll(async () => {
    orgId = await seedDemo();
    ym = await id('program', orgId, { code: 'YM' });
    ct = await id('program', orgId, { code: 'CT' });
    rent = await id('account', orgId, { number: '6210' });
    salaries = await id('account', orgId, { number: '6010' });
    payrollTaxes = await id('account', orgId, { number: '6020' });
    const line = await prisma.grantBudgetLine.findFirstOrThrow({
      where: { orgId, code: 'PERS', grant: { name: 'Culinary Workforce Grant' } },
      select: { id: true },
    });
    persLine = line.id;
  }, 300_000);
  afterAll(() => prisma.$disconnect());

  it('AC8: AllocatedLine totals per budget line equal the pre-phase baseline', async () => {
    expect(await demoAllocated(orgId)).toEqual(baseline.demo.allocated);
  });

  it('AC2: FormData, bounced state and in-memory values read to identical matchers JSON', () => {
    const v: RuleFormValues = {
      ...emptyRuleValues('crosswalk'),
      grantBudgetLineId: persLine,
      programIds: [ym],
      accountIds: [rent, salaries],
      descriptionContainsAny: 'rent, kitchen',
      dateFrom: '2026-01-01',
    };
    const fromData = matchersFromValues(
      readRuleValues(formDataReader(toFormData(v)), 'crosswalk'),
      'crosswalk',
    );
    const fromState = matchersFromValues(
      readRuleValues(
        formStateReader({
          errors: {},
          values: {
            grantBudgetLineId: persLine,
            programIds: [ym],
            accountIds: [rent, salaries],
            descriptionContainsAny: 'rent, kitchen',
            dateFrom: '2026-01-01',
            active: 'on',
          },
        }),
        'crosswalk',
      ),
      'crosswalk',
    );
    const fromValues = matchersFromValues(
      readRuleValues(valuesReader(v), 'crosswalk'),
      'crosswalk',
    );
    expect(JSON.stringify(fromData)).toBe(JSON.stringify(fromValues));
    expect(JSON.stringify(fromState)).toBe(JSON.stringify(fromValues));
    // Grant rules never carry programIds, even if a stray field arrives.
    expect(
      matchersFromValues(readRuleValues(formDataReader(toFormData(v)), 'grant'), 'grant'),
    ).not.toHaveProperty('programIds');
  });

  it('AC6: Youth Meals AND Rent previews 3 transactions · 180,000 cents in the app period', async () => {
    const range = await appRange(orgId);
    const values = { ...emptyRuleValues('crosswalk'), programIds: [ym], accountIds: [rent] };
    const p = await previewRuleForm(orgId, { kind: 'crosswalk', values, range });
    expect(p.count).toBe(3);
    expect(p.totalCents).toBe(180_000);
    expect(p.rows).toHaveLength(3);
    expect(p.rows.every((r) => r.account === '6210 Rent')).toBe(true);
    expect(p.warning).toBeNull();
  });

  it('AC5: superset warning names G-MWSC/PERS for a rule matching everything it matches, none for a disjoint rule', async () => {
    const range = await appRange(orgId);
    const superset = {
      ...emptyRuleValues('crosswalk'),
      grantBudgetLineId: persLine,
      programIds: [ct],
      accountIds: [salaries, payrollTaxes],
    };
    const p = await previewRuleForm(orgId, { kind: 'crosswalk', values: superset, range });
    expect(p.warning).toBe(supersetMessage('G-MWSC/PERS', 10));
    expect(p.warning).toBe(
      'This rule matches everything rule G-MWSC/PERS (priority 10) matches; it will never win.',
    );
    // Dropping the program makes it win unassigned-program lines, so it is no longer a superset.
    const wider = { ...superset, programIds: [] };
    const w = await previewRuleForm(orgId, { kind: 'crosswalk', values: wider, range });
    expect(w.count).toBeGreaterThan(0);
    expect(w.warning).toBeNull();
    const disjoint = {
      ...emptyRuleValues('crosswalk'),
      grantBudgetLineId: persLine,
      programIds: [ym],
      accountIds: [rent],
    };
    expect(
      (await previewRuleForm(orgId, { kind: 'crosswalk', values: disjoint, range })).warning,
    ).toBeNull();
  });

  it('AC4: a new rule with the priority field untouched saves at 50; editing keeps a stored priority', async () => {
    const fd = toFormData({
      ...emptyRuleValues('crosswalk'),
      grantBudgetLineId: persLine,
      programIds: [ym],
      accountIds: [rent],
      priority: '',
    });
    const parsed = parseRuleForm(formDataReader(fd), 'crosswalk', 'suggested');
    expect(parsed.errors).toEqual({});
    if (parsed.kind !== 'crosswalk' || !parsed.data) throw new Error('parse failed');
    expect(parsed.data.priority).toBe(DEFAULT_NEW_PRIORITY);
    expect(parsed.data.name).toBe('suggested');
    const created = await createCrosswalkRule(orgId, parsed.data);
    expect(created.priority).toBe(50);

    // A stored priority-10 seed rule re-submitted through the same parser keeps 10.
    const seed = await prisma.crosswalkRule.findFirstOrThrow({
      where: { orgId, name: 'G-MWSC/PERS' },
    });
    expect(seed.priority).toBe(10);
    const editFd = toFormData({
      ...emptyRuleValues('crosswalk'),
      name: seed.name!,
      grantBudgetLineId: persLine,
      programIds: [ct],
      accountIds: [salaries, payrollTaxes],
      priority: String(seed.priority),
    });
    const edit = parseRuleForm(formDataReader(editFd), 'crosswalk');
    if (edit.kind !== 'crosswalk' || !edit.data) throw new Error(JSON.stringify(edit.errors));
    const updated = await updateCrosswalkRule(orgId, seed.id, edit.data);
    expect(updated.priority).toBe(10);
    // Untouched groups are omitted, so the seed's two-key matchers come back unchanged.
    expect(parseMatchers(updated.matchers)).toEqual(parseMatchers(seed.matchers));
  });
});

describe('JPH-26 pilot seed (pseudonyms)', () => {
  let orgId: string;
  let salahId: string;

  beforeAll(async () => {
    orgId = await seedPilotOrg();
    const salah = await prisma.grant.findFirstOrThrow({
      where: { orgId, name: { startsWith: 'Salah' } },
      select: { id: true },
    });
    salahId = salah.id;
  }, 300_000);
  afterAll(() => prisma.$disconnect());

  it('AC8: GrantLineResult totals per working line equal the pre-phase baseline', async () => {
    const lines = await pilotGrantLines(orgId);
    expect(lines).toEqual(baseline.pilot.grantLines);
    expect(lines['Salah Foundation — Trauma Programs|PRACT|assigned']).toBe(710_000);
    expect(lines['Salah Foundation — Trauma Programs|DANA|assigned']).toBe(27_500);
  });

  it('AC3/AC6 golden: Salah Service Providers AND Dana Fairley → engine count · 27,500 cents', async () => {
    const range = await appRange(orgId);
    const serviceProviders = await id('account', orgId, { name: 'Service Providers - Programs' });
    const dana = await id('party', orgId, { displayName: 'Dana Fairley' });
    const line = await prisma.grantBudgetLine.findFirstOrThrow({
      where: { grantId: salahId, code: 'DANA' },
      select: { id: true },
    });
    const values = {
      ...emptyRuleValues('grant'),
      grantBudgetLineId: line.id,
      accountIds: [serviceProviders],
      partyIds: [dana],
    };
    const p = await previewRuleForm(orgId, { kind: 'grant', values, range, grantId: salahId });
    // The ticket says 1 transaction; the pilot export holds two Dana Fairley checks (125.00 and
    // 150.00) under Service Providers – Programs, both inside the app period. Recorded in
    // QUESTIONS.md; the total is the ticket's 27,500 cents either way.
    expect(p.totalCents).toBe(27_500);
    expect(p.count).toBe(2);
    expect(p.rows.map((r) => r.amountCents).sort((a, b) => a - b)).toEqual([12_500, 15_000]);
    expect(p.rows.every((r) => r.name === 'Dana Fairley')).toBe(true);
  });
});
