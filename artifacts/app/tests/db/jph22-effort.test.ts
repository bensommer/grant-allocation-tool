import { readFileSync } from 'node:fs';
import path from 'node:path';
import { parse as parseCsv } from 'csv-parse/sync';
import { beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '@/lib/db';
import { runImport } from '@/datasource/import-service';
import { QboReportDataSource } from '@/datasource/qbo-report/adapter';
import { parseQboReport, type Cell } from '@/datasource/qbo-report/parser';
import { readReportGrid } from '@/datasource/qbo-report/read';
import { assertBalanced, UnbalancedEntryError } from '@/domain/correcting-entry';
import { REVIEW_REASONS } from '@/engine/grant-stage';
import { currentRun, recompute } from '@/engine/recompute';
import { entryCsv, QBO_JE_HEADERS } from '@/reports/correcting-entry';
import {
  DestinationUnsetError,
  draftReclassForDecisionGroup,
  draftTrueUpForSchedule,
  grantDestination,
  listDrafts,
  saveDraft,
} from '@/services/correcting-entries';
import { carryVariance, createSchedule, effortSummary, upsertEntry } from '@/services/effort';
import { budgetTree, type BudgetLineView } from '@/services/grant-budget';
import { recordDecision } from '@/services/line-decisions';
import { reviewQueue } from '@/services/review';
import { saveDefaultDestination } from '@/services/settings';
import { ValidationError } from '@/services/programs';
import { seedPilot } from '@/seed/pilot';
import { createTestOrg, resetDatabase } from './helpers';

/**
 * JPH-22 acceptance criteria against the anonymized pilot seed (Phase 3: effort charges and
 * correcting entries). Every figure below comes from JPH-19 §6 F–G / JPH-22; never adjust one
 * here. Tests run in order — later criteria build on drafts and imports earlier ones create.
 * Posted fixtures are generated in memory from the tracked exports, never hand-written.
 */
const pilot = path.resolve(__dirname, '../../fixtures/pilot');
const SEED = path.join(pilot, 'seed.json');
const OPIOID_EXPORT = 'opioid-export.csv';
const SALAH_EXPORT = 'salah-export.csv';
const ORG = { companyName: 'Test Org', fiscalYearStartMonth: 1, currency: 'USD' };

const EFFORT_REASON = 'replaced by effort charge';
const PENDING_REASON = 'pending effort charge (phase 3)';

/** §6 F — coordinator charges by activity, in cents. */
const CHARGES: Record<string, number> = {
  "Daytime Mother's": 223_193,
  Conference: 89_277,
  'Teen Monthly': 133_916,
  "Mother's Exhaustion (virtual)": 46_579,
  'Sober Socials': 44_638,
};
const CHARGED_TOTAL = 537_603;
const BOOKED = 551_956;
const VARIANCE = 14_353;
const OPIOID_DIRECT = 722_654;
const OPIOID_STAFF = 68_353;
const OPIOID_OVERHEAD = 300_000;
const OPIOID_TOTAL_CHARGED = 1_628_610;
const OPIOID_REMAINING = 371_390;
const OPIOID_AWARD = 2_000_000;
const TEEN_COUNT_7 = 156_235;

const PRE_SEPT_LEAH_COUNT = 7;
const PRE_SEPT_LEAH_CENTS = 118_841;
const PAIR_113_96 = 11_396;
const SALAH_CODED_TO_GRANT = 2_152_040;

let orgId: string;
let salahId: string;
let opioidId: string;
let destinationClassId: string;

const CODE = /^GAT-\d{4}$/;
/** Journal date for drafts: inside both exports' date ranges, so a posted row is in scope on re-import. */
const POST_DATE = new Date('2026-09-22T00:00:00Z');

async function succeedRecompute() {
  const r = await recompute(orgId);
  expect(r.status, r.error).toBe('succeeded');
  return r;
}

async function kira() {
  const summary = await effortSummary(orgId, opioidId);
  const s = summary.schedules.find((x) => x.personLabel === 'Kira');
  if (!s) throw new Error('Kira schedule missing');
  return { summary, s };
}

const needsReview = (q: Awaited<ReturnType<typeof reviewQueue>>) =>
  q.groups.flatMap((g) => g.lines.map((l) => ({ ...l, reason: g.reason })));
const sum = (xs: Array<{ amountCents: number }>) => xs.reduce((s, x) => s + x.amountCents, 0);

async function setDestination(classId: string | null) {
  await saveDefaultDestination(orgId, { classId, partyId: null });
}

// --- in-memory posted fixtures ------------------------------------------------------------

async function loadRows(file: string): Promise<Cell[][]> {
  const grid = await readReportGrid(readFileSync(path.join(pilot, file)), file);
  return grid.rows;
}

function headerColumns(rows: Cell[][]): Record<string, number> {
  const header = rows.find((r) => r.some((c) => String(c ?? '').trim() === 'Transaction date'))!;
  const cols: Record<string, number> = {};
  header.forEach((c, i) => {
    const t = String(c ?? '').trim();
    if (t) cols[t] = i;
  });
  return cols;
}

const amountCellToCents = (cell: Cell) =>
  Math.round(Number(String(cell ?? '').replace(/[,$\s]/g, '')) * 100);
const centsToAmountCell = (cents: number) => (cents / 100).toFixed(2);

/**
 * Insert one journal-entry row at the end of an account section and add its amount to every
 * total row that encloses it (and TOTAL), so the export still balances — the mirror image of
 * `dropLine` in qbo-report.test.ts. Class / Name columns are filled when the export has them.
 */
function insertJournalLine(
  rows: Cell[][],
  cols: Record<string, number>,
  accountName: string,
  line: {
    date: string;
    num: string;
    description: string;
    cents: number;
    className?: string;
    name?: string;
  },
) {
  const amountCol = cols['Amount']!;
  const dateCol = cols['Transaction date']!;
  const totalIdx = rows.findIndex(
    (r) => String(r[0] ?? '').trim().toLowerCase() === `total for ${accountName}`.toLowerCase(),
  );
  if (totalIdx < 0) throw new Error(`no "Total for ${accountName}" row`);
  const width = rows[totalIdx]!.length;
  const cells: Cell[] = Array.from({ length: width }, () => '');
  cells[dateCol] = line.date;
  cells[cols['Transaction type']!] = 'Journal Entry';
  cells[cols['Num']!] = line.num;
  cells[cols['Description']!] = line.description;
  if (cols['Class full name'] !== undefined && line.className)
    cells[cols['Class full name']] = line.className;
  if (cols['Name'] !== undefined && line.name) cells[cols['Name']] = line.name;
  cells[amountCol] = centsToAmountCell(line.cents);
  rows.splice(totalIdx, 0, cells);
  const add = (row: Cell[]) => {
    row[amountCol] = centsToAmountCell(amountCellToCents(row[amountCol]) + line.cents);
  };
  let depth = 0;
  for (let i = totalIdx + 1; i < rows.length; i++) {
    const row = rows[i]!;
    const label = String(row[0] ?? '').trim();
    if (!label || /^\d{2}\/\d{2}\/\d{4}$/.test(String(row[dateCol] ?? ''))) continue;
    if (/^total$/i.test(label)) {
      add(row);
      break;
    }
    if (/^total for /i.test(label)) {
      if (depth > 0) depth--;
      else add(row);
    } else depth++;
  }
}

async function importRows(grantId: string, file: string, rows: Cell[][]) {
  const report = parseQboReport(rows, { fileName: file });
  if (!report.dateRange) throw new Error(`${file}: no date range parsed`);
  expect(report.errors).toEqual([]);
  const source = new QboReportDataSource({ report, fileName: file, sha256: 'test', org: ORG });
  return runImport(orgId, source, report.dateRange, {
    scope: { grantId, dateFrom: report.dateRange.from, dateTo: report.dateRange.to },
  });
}

/** The QuickBooks-import CSV for a draft, built the way the /csv route builds it. */
async function exportCsv(draft: Awaited<ReturnType<typeof listDrafts>>[number]) {
  const accounts = new Map(
    (await prisma.account.findMany({ where: { orgId } })).map((a) => [a.id, a.name]),
  );
  const grant = await prisma.grant.findUniqueOrThrow({ where: { id: draft.grantId } });
  return entryCsv({
    code: draft.code,
    kind: draft.kind,
    status: draft.status,
    date: draft.date,
    memo: draft.memo,
    grantName: grant.name,
    lines: draft.lines.map((l) => ({
      lineNumber: l.lineNumber,
      accountName: accounts.get(l.accountId)!,
      className: l.className,
      partyName: l.partyName,
      grantSide: l.grantSide,
      debitCents: l.debitCents,
      creditCents: l.creditCents,
      description: l.description,
    })),
  });
}

type CsvRow = Record<string, string>;
const csvCents = (v: string | undefined) => (v ? Math.round(Number(v) * 100) : 0);

/**
 * "Post" a draft from its CSV: the rows a bookkeeper would import into QuickBooks are read
 * back from the export, the ones coded to the grant (its QuickBooks class or project) are
 * appended to the grant's report export as journal-entry rows — one report row per journal
 * line, as QuickBooks exports them — and the export is re-imported. Nothing is taken from the
 * draft's stored lines; the round trip goes through the CSV.
 */
async function reimportWithPostedCsv(grantId: string, file: string, csv: string) {
  const grant = await prisma.grant.findUniqueOrThrow({ where: { id: grantId } });
  const parsed = parseCsv(csv, { columns: true }) as CsvRow[];
  expect(Object.keys(parsed[0]!)).toEqual([...QBO_JE_HEADERS]);
  // Every row must land somewhere: a class or a name.
  for (const r of parsed) expect(!!(r['Class'] || r['Name']), r['Journal/Description']).toBe(true);
  const onGrant = parsed.filter(
    (r) =>
      (grant.qboClassName && r['Class'] === grant.qboClassName) ||
      (grant.qboProjectName && r['Name'] === grant.qboProjectName),
  );
  expect(onGrant.length).toBeGreaterThan(0);
  const rows = await loadRows(file);
  const cols = headerColumns(rows);
  for (const r of onGrant) {
    insertJournalLine(rows, cols, r['Account Name']!, {
      date: r['Journal Date']!,
      num: r['Journal No.']!,
      description: r['Journal/Description']!,
      cents: csvCents(r['Debits']) - csvCents(r['Credits']),
      className: r['Class'],
      name: r['Name'],
    });
  }
  const result = await importRows(grantId, file, rows);
  return { result, onGrant, parsed };
}

async function postedReasonLines(grantId: string, code: string) {
  const run = await currentRun(orgId);
  return prisma.grantLineResult.findMany({
    where: { computeRunId: run!.id, grantId, reason: `posted correcting entry ${code}` },
  });
}

describe('JPH-22 effort charges and correcting entries (pilot seed)', () => {
  beforeAll(async () => {
    await resetDatabase();
    orgId = await createTestOrg();
    const summary = await seedPilot(orgId, SEED);
    salahId = summary.grants.find((g) => g.key === 'salah')!.grantId;
    opioidId = summary.grants.find((g) => g.key === 'opioid')!.grantId;
    expect(summary.grants.every((g) => g.imported)).toBe(true);
    expect(summary.grants.find((g) => g.key === 'opioid')!.schedules).toBe(1);
    await succeedRecompute();
    // A class that is neither grant's membership class stands in for the org's default destination.
    const cls = await prisma.trackingClass.findFirst({
      where: { orgId, name: { contains: 'Youth' } },
    });
    if (!cls) throw new Error('no destination class in the pilot export');
    destinationClassId = cls.id;
  }, 300_000);

  it('AC1: the coordinator schedule ($75,000 → 36.0577/h, 765 bps) charges 2,231.93 / 892.77 / 1,339.16 / 465.79 / 446.38 = 5,376.03 and the charges are booked as effort results', async () => {
    const { s } = await kira();
    expect(s.salaryCents).toBe(7_500_000);
    expect(s.rateDisplay).toBe('36.0577');
    expect(s.burdenBps).toBe(765);
    expect(s.targetCategoryKey).toBe('coordinator');
    expect(s.active).toBe(true);
    const byActivity = new Map(s.entries.map((e) => [e.activityName, e]));
    for (const [activity, cents] of Object.entries(CHARGES)) {
      const e = byActivity.get(activity);
      expect(e, activity).toBeDefined();
      expect(e!.chargeCents, activity).toBe(cents);
      expect(e!.runChargeCents, `${activity} (current run)`).toBe(cents);
    }
    expect(s.entries.map((e) => [e.activityName, e.count])).toEqual([
      ["Daytime Mother's", 10],
      ['Conference', 1],
      ['Teen Monthly', 6],
      ["Mother's Exhaustion (virtual)", 6],
      ['Sober Socials', 2],
    ]);
    expect(s.chargedCents).toBe(CHARGED_TOTAL);
    // Sober Socials is 446.38 under the schedule-total rounding rule, not the naive 446.39.
    expect(byActivity.get('Sober Socials')!.chargeCents).toBe(44_638);

    const run = await currentRun(orgId);
    const rows = await prisma.grantLineResult.findMany({
      where: { computeRunId: run!.id, grantId: opioidId, source: 'effort' },
      include: { budgetLine: true },
    });
    expect(rows).toHaveLength(5);
    expect(rows.every((r) => r.state === 'assigned' && r.transactionLineId === null)).toBe(true);
    expect(rows.every((r) => r.effortEntryId !== null)).toBe(true);
    expect(rows.every((r) => r.budgetLine?.categoryKey === 'coordinator')).toBe(true);
    expect(sum(rows)).toBe(CHARGED_TOTAL);
  });

  it('AC2: every coordinator payroll line is excluded as "replaced by effort charge", the phase-2 placeholders are superseded, and booked 5,519.56 − charged 5,376.03 = variance 143.53', async () => {
    const run = await currentRun(orgId);
    const excluded = await prisma.grantLineResult.findMany({
      where: { computeRunId: run!.id, grantId: opioidId, source: 'transaction', state: 'excluded' },
      include: { line: { include: { account: true } } },
    });
    const byEffort = excluded.filter((r) => r.reason === EFFORT_REASON);
    expect(byEffort.length).toBeGreaterThan(0);
    expect(sum(byEffort)).toBe(BOOKED);
    expect(new Set(byEffort.map((r) => r.line!.account.name))).toEqual(
      new Set(['Salaries', 'Payroll Tax Expense']),
    );
    // No placeholder exclusion survives, and none was deleted.
    expect(excluded.some((r) => r.reason === PENDING_REASON)).toBe(false);
    const placeholders = await prisma.lineDecision.findMany({
      where: { grantId: opioidId, reason: PENDING_REASON },
    });
    expect(placeholders.length).toBe(byEffort.length);
    expect(placeholders.every((d) => d.supersededAt !== null)).toBe(true);
    // Nothing on the grant needs review because of the coordinator.
    const q = await reviewQueue(orgId, opioidId);
    expect(needsReview(q).some((l) => /kira/i.test(l.description ?? ''))).toBe(false);

    const { s } = await kira();
    expect(s.bookedCents).toBe(BOOKED);
    expect(s.bookedLineCount).toBe(byEffort.length);
    expect(s.postedTrueUpCents).toBe(0);
    expect(s.chargedCents).toBe(CHARGED_TOTAL);
    expect(s.varianceCents).toBe(VARIANCE);
    expect(s.bookedAccounts[0]!.accountName).toBe('Salaries');
  });

  it('AC3: Opioid total charged is 16,286.10 (direct 7,226.54 + staff 683.53 + coordinator 5,376.03 + overhead 3,000.00) with 3,713.90 remaining of 20,000', async () => {
    const { summary } = await kira();
    expect(summary.awardCents).toBe(OPIOID_AWARD);
    expect(summary.effortChargedCents).toBe(CHARGED_TOTAL);
    expect(summary.assignedLinesCents).toBe(OPIOID_DIRECT + OPIOID_STAFF + OPIOID_OVERHEAD);
    expect(summary.totalChargedCents).toBe(OPIOID_TOTAL_CHARGED);
    expect(summary.remainingCents).toBe(OPIOID_REMAINING);

    const tree = await budgetTree(orgId, opioidId);
    expect(tree.totals.spentCents).toBe(OPIOID_DIRECT + OPIOID_STAFF + OPIOID_OVERHEAD);
    expect(tree.totals.effortCents).toBe(CHARGED_TOTAL);
    expect(tree.totals.chargedCents).toBe(OPIOID_TOTAL_CHARGED);
    // The funder category that owns the coordinator cells carries the charges as effort, not spend.
    const coordinatorCell = tree.all.find((l) => l.kind === 'cell' && l.categoryKey === 'coordinator')!;
    const owner = (id: string | null): BudgetLineView | undefined =>
      id === null
        ? undefined
        : (tree.categories.find((c) => c.id === id) ??
          owner(tree.all.find((l) => l.id === id)?.parentId ?? null));
    const coordinator = owner(coordinatorCell.parentId);
    expect(coordinator).toBeDefined();
    expect(coordinator!.effortCents).toBe(CHARGED_TOTAL);
    expect(coordinator!.spentCents).toBe(0);
    for (const [activity, cents] of Object.entries(CHARGES)) {
      const a = tree.activities.find((x) => x.name === activity)!;
      const cell = tree.all.find(
        (l) => l.kind === 'cell' && l.activityId === a.id && l.categoryKey === 'coordinator',
      )!;
      expect(cell.effortCents, activity).toBe(cents);
      expect(cell.chargedCents, activity).toBe(cents);
    }
  });

  it('AC5: "Carry variance" records the 143.53 variance with its note (note required) and leaves the numbers alone', async () => {
    await expect(carryVariance(orgId, opioidId, (await kira()).s.id, '   ')).rejects.toBeInstanceOf(
      ValidationError,
    );
    await carryVariance(orgId, opioidId, (await kira()).s.id, 'Carried to next quarter per funder');
    const { s, summary } = await kira();
    expect(s.carriedVarianceCents).toBe(VARIANCE);
    expect(s.carriedVarianceNote).toBe('Carried to next quarter per funder');
    expect(s.carriedAt).not.toBeNull();
    expect(s.varianceCents).toBe(VARIANCE);
    expect(summary.totalChargedCents).toBe(OPIOID_TOTAL_CHARGED);
  });

  it('AC8: an unbalanced correcting entry is rejected in the domain layer and cannot be saved', async () => {
    const account = await prisma.account.findFirstOrThrow({ where: { orgId, name: 'Salaries' } });
    const unbalanced = [
      {
        accountId: account.id,
        classId: null,
        partyId: null,
        className: null,
        partyName: 'Opioid project',
        grantSide: true,
        debitCents: 0,
        creditCents: 14_353,
        description: 'x',
      },
      {
        accountId: account.id,
        classId: destinationClassId,
        partyId: null,
        className: 'Youth Programs',
        partyName: null,
        grantSide: false,
        debitCents: 14_352,
        creditCents: 0,
        description: 'x',
      },
    ];
    expect(() => assertBalanced(unbalanced)).toThrow(UnbalancedEntryError);
    const before = await prisma.correctingEntryDraft.count({ where: { orgId } });
    await expect(
      saveDraft(orgId, {
        grantId: opioidId,
        kind: 'true_up',
        date: new Date('2026-09-22T00:00:00Z'),
        memo: 'unbalanced',
        build: () => ({ lines: unbalanced }),
      }),
    ).rejects.toBeInstanceOf(UnbalancedEntryError);
    expect(await prisma.correctingEntryDraft.count({ where: { orgId } })).toBe(before);
    expect(await prisma.correctingEntryLine.count({ where: { draft: { orgId } } })).toBe(0);
  });

  it('AC4: "Draft true-up" is blocked until a destination is set, then drafts one balanced 143.53 entry (code in memo) whose CSV balances; re-importing the export with the posted entry marks it posted and the variance reads 0.00', async () => {
    const { s } = await kira();
    await expect(draftTrueUpForSchedule(orgId, opioidId, s.id)).rejects.toBeInstanceOf(
      DestinationUnsetError,
    );
    expect(await listDrafts(orgId, opioidId)).toHaveLength(0);

    await setDestination(destinationClassId);
    const draft = await draftTrueUpForSchedule(orgId, opioidId, s.id, 'test', POST_DATE);
    expect(draft.code).toMatch(CODE);
    expect(draft.kind).toBe('true_up');
    expect(draft.status).toBe('drafted');
    expect(draft.memo).toContain(draft.code);
    expect(draft.sourceScheduleId).toBe(s.id);
    const debits = draft.lines.reduce((t, l) => t + l.debitCents, 0);
    const credits = draft.lines.reduce((t, l) => t + l.creditCents, 0);
    expect(debits).toBe(VARIANCE);
    expect(credits).toBe(VARIANCE);
    const grantSide = draft.lines.filter((l) => l.grantSide);
    expect(grantSide).toHaveLength(1);
    expect(grantSide[0]!.creditCents).toBe(VARIANCE);
    expect(draft.lines.find((l) => !l.grantSide)!.classId).toBe(destinationClassId);
    const account = await prisma.account.findUniqueOrThrow({ where: { id: grantSide[0]!.accountId } });
    expect(account.name).toBe('Salaries');

    // The grant side is coded to the grant's QuickBooks project; the other side to the destination.
    expect(grantSide[0]!.partyName).toBe('2025-2026 Opioid Grant');
    expect(draft.lines.find((l) => !l.grantSide)!.className).toBe('Youth Programs');

    // CSV export parses under the QuickBooks journal-entry headers and balances.
    const listed = (await listDrafts(orgId, opioidId)).find((d) => d.code === draft.code)!;
    expect(listed.amountCents).toBe(VARIANCE);
    const csv = await exportCsv(listed);
    const parsed = parseCsv(csv, { columns: true }) as CsvRow[];
    expect(Object.keys(parsed[0]!)).toEqual([...QBO_JE_HEADERS]);
    expect(parsed).toHaveLength(2);
    expect(parsed.reduce((t, r) => t + csvCents(r['Debits']), 0)).toBe(VARIANCE);
    expect(parsed.reduce((t, r) => t + csvCents(r['Credits']), 0)).toBe(VARIANCE);
    expect(parsed.every((r) => r['Journal No.'] === draft.code)).toBe(true);
    expect(parsed.map((r) => r['Name'])).toEqual(['2025-2026 Opioid Grant', '']);
    expect(parsed.map((r) => r['Class'])).toEqual(['', 'Youth Programs']);

    // A second true-up for the same open variance is refused.
    await expect(draftTrueUpForSchedule(orgId, opioidId, s.id)).rejects.toMatchObject({
      fieldErrors: { _: expect.stringMatching(/already drafted/) },
    });
    expect(await listDrafts(orgId, opioidId)).toHaveLength(1);

    // Post it in QuickBooks from the CSV → the next export carries the grant-side row with the code.
    const { result, onGrant } = await reimportWithPostedCsv(opioidId, OPIOID_EXPORT, csv);
    expect(onGrant).toHaveLength(1);
    expect(result.status).toBe('succeeded');
    const posted = await prisma.correctingEntryDraft.findUniqueOrThrow({ where: { id: draft.id } });
    expect(posted.status).toBe('posted');
    expect(posted.postedTransactionId).not.toBeNull();
    const txn = await prisma.transaction.findUniqueOrThrow({
      where: { id: posted.postedTransactionId! },
      include: { lines: true },
    });
    expect(txn.txnType).toBe('JournalEntry');
    expect(txn.lines.some((l) => l.description?.includes(draft.code))).toBe(true);

    await succeedRecompute();
    const postedLines = await postedReasonLines(opioidId, draft.code);
    expect(postedLines).toHaveLength(1);
    expect(postedLines[0]!.state).toBe('excluded');
    expect(postedLines[0]!.amountCents).toBe(-VARIANCE);
    const after = await kira();
    expect(after.s.postedTrueUpCents).toBe(-VARIANCE);
    expect(after.s.bookedCents).toBe(CHARGED_TOTAL);
    expect(after.s.varianceCents).toBe(0);
    expect(after.summary.totalChargedCents).toBe(OPIOID_TOTAL_CHARGED);
    expect(after.summary.remainingCents).toBe(OPIOID_REMAINING);
    // Detection is idempotent: importing again changes nothing.
    await reimportWithPostedCsv(opioidId, OPIOID_EXPORT, csv);
    const again = await prisma.correctingEntryDraft.findUniqueOrThrow({ where: { id: draft.id } });
    expect(again.postedTransactionId).toBe(posted.postedTransactionId);
    expect(again.postedAt?.getTime()).toBe(posted.postedAt?.getTime());
  });

  it('AC7: changing Teen Monthly\'s completed count 6 → 7 and recomputing gives a Teen charge of 1,562.35 (±0.01) with total and variance updated', async () => {
    const before = await kira();
    const teen = before.s.entries.find((e) => e.activityName === 'Teen Monthly')!;
    await upsertEntry(orgId, opioidId, before.s.id, {
      activityId: teen.activityId,
      hoursPerOccurrence: teen.hoursPerOccurrence,
      completedCountOverride: 7,
      sortOrder: teen.sortOrder,
    });
    await succeedRecompute();
    const after = await kira();
    const teenAfter = after.s.entries.find((e) => e.activityName === 'Teen Monthly')!;
    expect(teenAfter.count).toBe(7);
    expect(Math.abs(teenAfter.chargeCents - TEEN_COUNT_7)).toBeLessThanOrEqual(1);
    expect(teenAfter.runChargeCents).toBe(teenAfter.chargeCents);
    const delta = teenAfter.chargeCents - teen.chargeCents;
    expect(after.s.chargedCents).toBe(before.s.chargedCents + delta);
    expect(after.s.varianceCents).toBe(before.s.varianceCents - delta);
    expect(after.summary.totalChargedCents).toBe(before.summary.totalChargedCents + delta);
    expect(after.summary.remainingCents).toBe(before.summary.remainingCents - delta);
    // Restore the seeded count so the remaining criteria read the pilot figures.
    await upsertEntry(orgId, opioidId, before.s.id, {
      activityId: teen.activityId,
      hoursPerOccurrence: teen.hoursPerOccurrence,
      completedCountOverride: null,
      sortOrder: teen.sortOrder,
    });
    await succeedRecompute();
    expect((await kira()).s.chargedCents).toBe(CHARGED_TOTAL);
  });

  it('AC6: excluding the 7 pre-September Leah lines on Salah (D1-B) drafts one balanced 1,188.41 reclass — blocked while the destination is unset — and posting it leaves 21,520.40 coded to the grant with an empty queue', async () => {
    // Confirm the ±113.96 pair first, as Phase 2 does.
    const q0 = await reviewQueue(orgId, salahId);
    const pair = q0.proposals.find((p) => p.amountCents === PAIR_113_96)!;
    expect(pair).toBeDefined();
    await recordDecision(orgId, salahId, {
      kind: 'reversal_pair',
      lineIds: [pair.positive.id, pair.negative.id],
      targetBudgetLineId: null,
      reason: null,
      note: 'confirmed ±113.96 pair',
    });
    await succeedRecompute();
    const pending = needsReview(await reviewQueue(orgId, salahId));
    expect(pending).toHaveLength(PRE_SEPT_LEAH_COUNT);
    expect(sum(pending)).toBe(PRE_SEPT_LEAH_CENTS);
    expect(new Set(pending.map((l) => l.reason))).toEqual(new Set([REVIEW_REASONS.noRule]));

    const { groupId } = await recordDecision(orgId, salahId, {
      kind: 'exclude',
      lineIds: pending.map((l) => l.id),
      targetBudgetLineId: null,
      reason: 'not allowable',
      note: 'D1-B: pre-September payroll is outside the award period',
    });
    // Blocked while no destination is set; the exclusion itself stands.
    await setDestination(null);
    await expect(draftReclassForDecisionGroup(orgId, salahId, groupId)).rejects.toBeInstanceOf(
      DestinationUnsetError,
    );
    expect(await listDrafts(orgId, salahId)).toHaveLength(0);
    await setDestination(destinationClassId);
    const draft = await draftReclassForDecisionGroup(orgId, salahId, groupId, 'test', POST_DATE);
    expect(draft.code).toMatch(CODE);
    expect(draft.kind).toBe('reclass');
    expect(draft.sourceDecisionGroupId).toBe(groupId);
    expect(draft.memo).toContain(draft.code);
    const debits = draft.lines.reduce((t, l) => t + l.debitCents, 0);
    const credits = draft.lines.reduce((t, l) => t + l.creditCents, 0);
    expect(debits).toBe(PRE_SEPT_LEAH_CENTS);
    expect(credits).toBe(PRE_SEPT_LEAH_CENTS);
    const grantSide = draft.lines.filter((l) => l.grantSide);
    expect(grantSide.reduce((t, l) => t + l.creditCents - l.debitCents, 0)).toBe(PRE_SEPT_LEAH_CENTS);
    // The description lists every original line (date + amount).
    for (const l of pending) {
      const amount = (l.amountCents / 100).toFixed(2);
      expect(grantSide.some((g) => g.description.includes(amount)), amount).toBe(true);
    }
    expect(await listDrafts(orgId, salahId)).toHaveLength(1);
    // Drafting the same group twice does not create a second draft.
    await expect(draftReclassForDecisionGroup(orgId, salahId, groupId)).rejects.toBeInstanceOf(
      ValidationError,
    );
    expect(await listDrafts(orgId, salahId)).toHaveLength(1);

    await succeedRecompute();
    const beforePost = await budgetTree(orgId, salahId);
    expect(beforePost.totals.spentCents).toBe(SALAH_CODED_TO_GRANT);

    // Grant side coded to the grant's QuickBooks class; posted from the CSV.
    expect(grantSide.every((l) => l.className === 'Trauma Grants')).toBe(true);
    const listed = (await listDrafts(orgId, salahId))[0]!;
    const { result, onGrant } = await reimportWithPostedCsv(salahId, SALAH_EXPORT, await exportCsv(listed));
    expect(onGrant).toHaveLength(grantSide.length);
    expect(result.status).toBe('succeeded');
    const posted = await prisma.correctingEntryDraft.findUniqueOrThrow({ where: { id: draft.id } });
    expect(posted.status).toBe('posted');
    expect(posted.postedTransactionId).not.toBeNull();

    await succeedRecompute();
    const postedLines = await postedReasonLines(salahId, draft.code);
    expect(postedLines).toHaveLength(grantSide.length);
    expect(postedLines.every((l) => l.state === 'excluded')).toBe(true);
    expect(sum(postedLines)).toBe(-PRE_SEPT_LEAH_CENTS);
    const tree = await budgetTree(orgId, salahId);
    expect(tree.totals.spentCents).toBe(SALAH_CODED_TO_GRANT);
    expect(tree.totals.chargedCents).toBe(SALAH_CODED_TO_GRANT);
    const q = await reviewQueue(orgId, salahId);
    expect(q.counts.needsReview).toBe(0);
    expect(q.excluded.filter((l) => l.reason === 'not allowable')).toHaveLength(PRE_SEPT_LEAH_COUNT);
    // The exclusion decisions were superseded by nothing — they still stand.
    expect(
      await prisma.lineDecision.count({ where: { groupId, kind: 'exclude', supersededAt: null } }),
    ).toBe(PRE_SEPT_LEAH_COUNT);
  });

  it('AC9: the Phase 1/2 pilot figures are unchanged with effort charges in place (Opioid direct 7,226.54; Salah working lines; states balanced)', async () => {
    const opioid = await budgetTree(orgId, opioidId);
    const direct = ['practitioners', 'food', 'supplies'];
    const directCents = opioid.all
      .filter((l) => l.kind === 'cell' && direct.includes(l.categoryKey ?? ''))
      .reduce((t, l) => t + l.spentCents, 0);
    expect(directCents).toBe(OPIOID_DIRECT);
    const salah = await budgetTree(orgId, salahId);
    const spent = new Map(salah.all.map((l) => [l.code, l.spentCents]));
    expect(spent.get('KIRA')).toBe(519_264);
    expect(spent.get('PRACT')).toBe(710_000);
    expect(spent.get('LEAH')).toBe(90_706);
    expect(spent.get('SUPP')).toBe(549_310);
    const run = await currentRun(orgId);
    expect(run?.status).toBe('succeeded');
    // Effort results never count as transaction-line states.
    expect(
      await prisma.grantLineResult.count({
        where: { computeRunId: run!.id, source: 'effort', transactionLineId: { not: null } },
      }),
    ).toBe(0);
  });

  it('AC4/AC6 posting: a reclass spanning two accounts posts as one journal row per line in the export and is still detected (grant-side rows aggregated, every row excluded)', async () => {
    // Two assigned Salah lines on different accounts, excluded together.
    const q = await reviewQueue(orgId, salahId);
    const byAccount = new Map<string, (typeof q.assigned)[number]>();
    for (const l of q.assigned) if (l.amountCents > 0 && !byAccount.has(l.account)) byAccount.set(l.account, l);
    const picked = [...byAccount.values()].slice(0, 2);
    expect(picked).toHaveLength(2);
    const { groupId } = await recordDecision(orgId, salahId, {
      kind: 'exclude',
      lineIds: picked.map((l) => l.id),
      targetBudgetLineId: null,
      reason: 'not allowable',
      note: 'posting test: two accounts in one entry',
    });
    const draft = await draftReclassForDecisionGroup(orgId, salahId, groupId, 'test', POST_DATE);
    const grantSide = draft.lines.filter((l) => l.grantSide);
    expect(grantSide).toHaveLength(2);
    expect(new Set(grantSide.map((l) => l.accountId)).size).toBe(2);
    const total = sum(picked);
    expect(grantSide.reduce((t, l) => t + l.creditCents, 0)).toBe(total);

    const listed = (await listDrafts(orgId, salahId)).find((d) => d.code === draft.code)!;
    const { result, onGrant } = await reimportWithPostedCsv(salahId, SALAH_EXPORT, await exportCsv(listed));
    expect(result.status).toBe('succeeded');
    expect(onGrant).toHaveLength(2);
    const posted = await prisma.correctingEntryDraft.findUniqueOrThrow({ where: { id: draft.id } });
    expect(posted.status).toBe('posted');
    // Each export row became its own transaction; the code is detected across both.
    const carriers = await prisma.transactionLine.findMany({
      where: { orgId, deletedAt: null, description: { contains: draft.code } },
    });
    expect(carriers).toHaveLength(2);
    expect(new Set(carriers.map((l) => l.transactionId)).size).toBe(2);
    expect(carriers.map((l) => l.transactionId)).toContain(posted.postedTransactionId);

    await succeedRecompute();
    const postedLines = await postedReasonLines(salahId, draft.code);
    expect(postedLines).toHaveLength(2);
    expect(postedLines.every((l) => l.state === 'excluded')).toBe(true);
    expect(sum(postedLines)).toBe(-total);
    // Neither the excluded originals nor the posted rows count toward the grant.
    const after = await reviewQueue(orgId, salahId);
    expect(after.counts.needsReview).toBe(0);
    expect(after.excluded.filter((l) => l.reason === `posted correcting entry ${draft.code}`)).toHaveLength(2);
  });

  it('guard: an active schedule with empty payroll matchers is rejected (it would exclude every line on the grant)', async () => {
    const before = await prisma.effortSchedule.count({ where: { orgId } });
    const blank = {
      personLabel: 'Nobody',
      personPartyId: null,
      salaryCents: 5_000_000,
      hourlyRate: null,
      burdenBps: 0,
      targetCategoryKey: 'coordinator',
      actualPayrollMatchers: { accountIds: [], descriptionContainsAny: [] },
      active: true,
    };
    await expect(createSchedule(orgId, opioidId, blank)).rejects.toMatchObject({
      fieldErrors: { actualPayrollMatchers: expect.stringMatching(/payroll matchers/) },
    });
    expect(await prisma.effortSchedule.count({ where: { orgId } })).toBe(before);
    // An inactive draft schedule may be saved without matchers; activating it needs them.
    const inactive = await createSchedule(orgId, opioidId, { ...blank, active: false });
    expect(inactive.active).toBe(false);
  });

  it('guard: the grant side of an entry uses the configured full class name (Parent:Child) over the ledger leaf name', async () => {
    const leaf = await prisma.trackingClass.findFirstOrThrow({ where: { id: destinationClassId } });
    const g = await prisma.grant.create({
      data: {
        orgId,
        name: 'Nested-class grant',
        funder: 'Test',
        startDate: new Date('2026-01-01'),
        endDate: new Date('2026-12-31'),
        awardAmountCents: 100,
        memberClassIds: [leaf.id],
        qboClassName: `Programs:${leaf.name}`,
      },
    });
    const withFull = await grantDestination(orgId, g.id);
    expect(withFull).toMatchObject({ classId: leaf.id, className: `Programs:${leaf.name}` });
    await prisma.grant.update({ where: { id: g.id }, data: { qboClassName: null } });
    const leafOnly = await grantDestination(orgId, g.id);
    expect(leafOnly).toMatchObject({ classId: leaf.id, className: leaf.name });
    await prisma.grant.update({ where: { id: g.id }, data: { memberClassIds: [] } });
    await expect(grantDestination(orgId, g.id)).rejects.toMatchObject({
      fieldErrors: { _: expect.stringMatching(/QuickBooks class or project/) },
    });
    await prisma.grant.update({ where: { id: g.id }, data: { status: 'archived' } });
  });
});
