/**
 * JPH-23 Phase 4 — periods, release classes and the restricted-funds rollforward.
 *
 * AC1 rollforward figures (Opioid FY2026 through 9/22/2026, Salah D1-A)
 * AC2 beginning balance from the reported FY2025 snapshot
 * AC3 closed periods are never recomputed: drift shows books vs. reported
 * AC7 reported-period form writes snapshot rows (supersedes, never deletes)
 * Expected values come from JPH-19 §6 / JPH-23; they are not derived here.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import ExcelJS from 'exceljs';
import { beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '@/lib/db';
import { utcDate } from '@/domain/dates';
import { recompute } from '@/engine/recompute';
import {
  beginningBalance,
  grantPeriodSnapshots,
  grantRollforward,
  periodDrift,
  recordReportedPeriod,
  rollforward,
  snapshotLockedPeriod,
} from '@/services/grant-periods';
import { rollforwardNotes, tieOut } from '@/services/grant-workspace';
import { recordDecision } from '@/services/line-decisions';
import { deletePeriodLock, lockPeriod } from '@/services/periods';
import { ROLLFORWARD_LAYOUT, rollforwardXlsx } from '@/reports/rollforward-xlsx';
import { reviewQueue } from '@/services/review';
import { seedPilot } from '@/seed/pilot';
import { createTestOrg, resetDatabase } from './helpers';

const SEED = path.resolve(__dirname, '../../fixtures/pilot/seed.json');
const FROM = utcDate(2026, 1, 1);
const TO = utcDate(2026, 9, 22);

let orgId: string;
let salahId: string;
let opioidId: string;

/** D1: the pre-September Leah pay that is coded to Salah but in no budget line. */
async function decideD1(kind: 'assign' | 'exclude') {
  const queue = await reviewQueue(orgId, salahId);
  const d1 = new Set(queue.decisions.filter((d) => /^D1-/.test(d.reason ?? '')).map((d) => d.id));
  const lineIds = [
    ...queue.groups.flatMap((g) => g.lines.map((l) => l.id)),
    ...[...queue.assigned, ...queue.excluded]
      .filter((l) => l.decisionId && d1.has(l.decisionId))
      .map((l) => l.id),
  ];
  expect(lineIds.length).toBeGreaterThan(0);
  const leah = await prisma.grantBudgetLine.findFirstOrThrow({
    where: { grantId: salahId, code: 'LEAH' },
  });
  await recordDecision(
    orgId,
    salahId,
    kind === 'assign'
      ? {
          kind,
          lineIds,
          targetBudgetLineId: leah.id,
          reason: 'D1-A',
          note: 'D1-A: pre-September Leah pay counts toward the Leah line.',
        }
      : {
          kind,
          lineIds,
          targetBudgetLineId: null,
          reason: 'D1-B',
          note: 'D1-B: pre-September Leah pay leaves the grant by correcting entry.',
        },
    'test',
  );
  const r = await recompute(orgId);
  expect(r.status, r.error).toBe('succeeded');
}

beforeAll(async () => {
  await resetDatabase();
  orgId = await createTestOrg();
  const summary = await seedPilot(orgId, SEED);
  salahId = summary.grants.find((g) => g.key === 'salah')!.grantId;
  opioidId = summary.grants.find((g) => g.key === 'opioid')!.grantId;
  const r = await recompute(orgId);
  expect(r.status, r.error).toBe('succeeded');
}, 300_000);

describe('AC1 beginning balance from the reported FY2025 period', () => {
  it('seeds one reported FY2025 snapshot for Opioid: 2,120 / 833 / 3,000 released, 20,000 received', async () => {
    const snaps = await grantPeriodSnapshots(orgId, opioidId);
    expect(snaps).toHaveLength(1);
    const fy25 = snaps[0]!;
    expect(fy25.source).toBe('reported');
    expect(fy25.periodFrom).toEqual(utcDate(2025, 1, 1));
    expect(fy25.periodTo).toEqual(utcDate(2025, 12, 31));
    expect(fy25.released).toEqual({ direct: 212000, staff: 83300, overhead: 300000 });
    expect(fy25.receivedCents).toBe(2000000);
    expect(fy25.note).toMatch(/rounded to whole dollars/);
    const lock = await prisma.periodLock.findUniqueOrThrow({ where: { id: fy25.lockId } });
    expect(lock.computeRunId).toBeNull();
  });

  it('Opioid beginning balance at 1/1/2026 is 14,047.00', async () => {
    const b = await beginningBalance(orgId, opioidId, FROM);
    expect(b.beginningCents).toBe(1404700);
    expect(b.periods.map((p) => p.name)).toEqual(['FY2025']);
  });

  it('Salah has no prior period: beginning balance 0.00', async () => {
    const b = await beginningBalance(orgId, salahId, FROM);
    expect(b.beginningCents).toBe(0);
    expect(b.periods).toEqual([]);
  });
});

describe('AC3 rollforward 1/1/2026–9/22/2026', () => {
  it('Opioid column: 14,047.00 / 0.00 / 5,106.54 / 5,226.56 / 0.00 → 3,713.90', async () => {
    const r = await grantRollforward(orgId, opioidId, FROM, TO);
    expect(r.beginningCents).toBe(1404700);
    expect(r.receivedCents).toBe(0);
    expect(r.released.direct).toBe(510654);
    expect(r.released.staff).toBe(522656);
    expect(r.released.overhead).toBe(0);
    expect(r.endingCents).toBe(371390);
  });

  it('Salah before D1: 1,188.41 coded but not released; column shows 21,520.40 released', async () => {
    const t = await tieOut(orgId, salahId);
    expect(t.codedCents).toBe(2270881);
    expect(t.needsReviewCents).toBe(118841);
    expect(t.green).toBe(false);
    const r = await grantRollforward(orgId, salahId, FROM, TO);
    expect(r.beginningCents).toBe(0);
    expect(r.receivedCents).toBe(5000000);
    expect(r.released).toEqual({ direct: 2152040, staff: 0, overhead: 0 });
    const notes = await rollforwardNotes(orgId, salahId);
    expect(notes.some((n) => /needs review/.test(n.text))).toBe(true);
  });

  it('Salah D1-A (pre-September Leah pay assigned to Leah): released 22,708.81 → 27,291.19, with a note linking to the decision', async () => {
    await decideD1('assign');
    const r = await grantRollforward(orgId, salahId, FROM, TO);
    expect(r.released).toEqual({ direct: 2270881, staff: 0, overhead: 0 });
    expect(r.endingCents).toBe(2729119);
    const notes = await rollforwardNotes(orgId, salahId);
    const d1 = notes.find((n) => /D1-A/.test(n.text));
    expect(d1).toBeDefined();
    expect(d1!.href).toMatch(new RegExp(`^/grants/${salahId}/review#decision-`));
    expect((await tieOut(orgId, salahId)).green).toBe(true);
  });

  it('Salah D1-B (excluded, correcting entry): released 21,520.40 → 28,479.60', async () => {
    await decideD1('exclude');
    const r = await grantRollforward(orgId, salahId, FROM, TO);
    expect(r.released).toEqual({ direct: 2152040, staff: 0, overhead: 0 });
    expect(r.endingCents).toBe(2847960);
    const t = await tieOut(orgId, salahId);
    expect(t.green).toBe(true);
    expect(t.excluded.find((e) => e.reason === 'D1-B')?.cents).toBe(118841);
    await decideD1('assign'); // leave the org under D1-A for the tests that follow
  });

  it('totals foot and the check is 0.00 (D1-A)', async () => {
    const r = await rollforward(orgId, FROM, TO);
    expect(r.rows.map((x) => x.name)).toEqual([
      'Opioid Prevention — Town of Bayport',
      'Salah Foundation — Trauma Programs',
    ]);
    expect(r.totals.beginningCents).toBe(1404700);
    expect(r.totals.receivedCents).toBe(5000000);
    expect(r.totals.released).toEqual({ direct: 2781535, staff: 522656, overhead: 0 });
    expect(r.totals.endingCents).toBe(371390 + 2729119);
    expect(r.totals.checkCents).toBe(0);
  });
});

/** LibreOffice binary: $SOFFICE_PATH, PATH, or the newest wrapped build in the nix store. */
function findSoffice(): string {
  if (process.env.SOFFICE_PATH && existsSync(process.env.SOFFICE_PATH)) return process.env.SOFFICE_PATH;
  for (const dir of (process.env.PATH ?? '').split(':')) {
    const p = path.join(dir, 'soffice');
    if (dir && existsSync(p)) return p;
  }
  const store = '/nix/store';
  const candidates = existsSync(store)
    ? readdirSync(store)
        .filter((d) => /-libreoffice-[\d.]+-wrapped$/.test(d))
        .map((d) => path.join(store, d, 'bin', 'soffice'))
        .filter((p) => existsSync(p))
        .sort()
    : [];
  const pick = candidates.at(-1);
  if (!pick) throw new Error('LibreOffice (soffice) not found; set SOFFICE_PATH for the AC4 test');
  return pick;
}

describe('AC4 rollforward XLSX uses formulas', () => {
  it('ending and check cells are formulas; LibreOffice recalculation reproduces the AC3 endings from poisoned caches', async () => {
    const rf = await rollforward(orgId, FROM, TO);
    const buf = await rollforwardXlsx(rf);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buf as unknown as ArrayBuffer);
    const ws = wb.getWorksheet('Restricted Grants')!;
    const { beginning, ending, check, firstCol } = ROLLFORWARD_LAYOUT;
    const totalCol = firstCol + rf.rows.length;
    let formulas = 0;
    for (let c = firstCol; c <= totalCol; c++) {
      const v = ws.getCell(ending, c).value as ExcelJS.CellFormulaValue;
      expect(v && typeof v === 'object' && 'formula' in v, `ending col ${c}`).toBe(true);
      // Poison the cached result so only a real recalculation can produce the right number.
      ws.getCell(ending, c).value = { formula: v.formula, result: -1 };
      formulas++;
    }
    for (let r = beginning; r <= ending; r++) {
      const v = ws.getCell(r, totalCol).value as ExcelJS.CellFormulaValue;
      expect(typeof v === 'object' && v !== null && 'formula' in v, `total row ${r}`).toBe(true);
      ws.getCell(r, totalCol).value = { formula: v.formula, result: -1 };
      formulas++;
    }
    const chk = ws.getCell(check, totalCol).value as ExcelJS.CellFormulaValue;
    expect(chk.formula).toMatch(/ROUND/);
    ws.getCell(check, totalCol).value = { formula: chk.formula, result: -1 };
    expect(formulas).toBeGreaterThanOrEqual(3 + 6);

    const dir = mkdtempSync(path.join(os.tmpdir(), 'jph23-lo-'));
    const src = path.join(dir, 'rollforward.xlsx');
    writeFileSync(src, Buffer.from(await wb.xlsx.writeBuffer()));
    // A throwaway profile that tells Calc to always recalculate OOXML formulas on load.
    const profile = path.join(dir, 'profile');
    mkdirSync(path.join(profile, 'user'), { recursive: true });
    writeFileSync(
      path.join(profile, 'user', 'registrymodifications.xcu'),
      `<?xml version="1.0" encoding="UTF-8"?>
<oor:items xmlns:oor="http://openoffice.org/2001/registry" xmlns:xs="http://www.w3.org/2001/XMLSchema" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
<item oor:path="/org.openoffice.Office.Calc/Formula/Load"><prop oor:name="OOXMLRecalcMode" oor:op="fuse"><value>0</value></prop></item>
</oor:items>
`,
    );
    execFileSync(
      findSoffice(),
      [
        '--headless',
        `-env:UserInstallation=file://${profile}`,
        '--convert-to',
        'csv:Text - txt - csv (StarCalc):44,34,76,1,,0,false,true,false,false,false,1',
        '--outdir',
        dir,
        src,
      ],
      { env: { ...process.env, HOME: dir }, stdio: 'pipe', timeout: 180_000 },
    );
    const csvName = readdirSync(dir).find((f) => f.endsWith('.csv'));
    expect(csvName, 'LibreOffice wrote a CSV').toBeDefined();
    const lines = readFileSync(path.join(dir, csvName!), 'utf8').split(/\r?\n/);
    const endingRow = lines[ending - 1]!.split(',');
    expect(endingRow[0]).toBe('Ending restricted balance');
    // Opioid 3,713.90 and Salah 27,291.19 (D1-A) from AC1/AC3; total 31,005.09.
    expect(Number(endingRow[firstCol - 1])).toBe(3713.9);
    expect(Number(endingRow[firstCol])).toBe(27291.19);
    expect(Number(endingRow[totalCol - 1])).toBe(31005.09);
    const checkRow = lines[check - 1]!.split(',');
    expect(Number(checkRow[totalCol - 1])).toBe(0);
  }, 240_000);
});

describe('AC6 tie-out', () => {
  it('Opioid: green check, effort charges on their own line, ±207.02 pair counted as paired', async () => {
    const t = await tieOut(orgId, opioidId);
    expect(t.green).toBe(true);
    expect(t.effortCents).toBe(537603);
    expect(t.needsReviewCents).toBe(0);
    expect(t.needsReviewCount).toBe(2);
    expect(t.pairedCount).toBe(2);
    expect(t.chargedCents).toBe(t.assignedCents + t.effortCents);
    expect(t.codedCents).toBe(t.assignedCents + t.excludedCents + t.needsReviewCents);
  });
});

describe('AC2 drift panel; closed periods are never recomputed', () => {
  it('FY2025 drift: reported direct 2,120.00 vs. books 1,932.34; overhead ties; staff not computed', async () => {
    const rows = await periodDrift(orgId, opioidId);
    const direct = rows.find((r) => r.cls === 'direct')!;
    expect(direct.reportedCents).toBe(212000);
    expect(direct.booksCents).toBe(193234);
    expect(direct.driftCents).toBe(193234 - 212000);
    const overhead = rows.find((r) => r.cls === 'overhead')!;
    expect(overhead.reportedCents).toBe(300000);
    expect(overhead.booksCents).toBe(300000);
    expect(overhead.driftCents).toBe(0);
    const staff = rows.find((r) => r.cls === 'staff')!;
    expect(staff.booksCents).toBeNull();
    expect(staff.driftCents).toBeNull();
  });

  it('a recompute leaves the reported snapshot untouched and the rollforward unchanged', async () => {
    const before = await grantPeriodSnapshots(orgId, opioidId);
    const r = await recompute(orgId);
    expect(r.status, r.error).toBe('succeeded');
    const after = await grantPeriodSnapshots(orgId, opioidId);
    expect(after).toEqual(before);
    const rf = await grantRollforward(orgId, opioidId, FROM, TO);
    expect(rf.beginningCents).toBe(1404700);
    expect(rf.endingCents).toBe(371390);
  });

  it('locking a period in the app freezes computed snapshots; the reported one is kept', async () => {
    const lock = await lockPeriod(orgId, 'FY2026 YTD', FROM, TO, 'test lock');
    const snaps = await grantPeriodSnapshots(orgId, opioidId);
    expect(snaps.map((s) => [s.name, s.source])).toEqual([
      ['FY2025', 'reported'],
      ['FY2026 YTD', 'computed'],
    ]);
    const ytd = snaps[1]!;
    expect(ytd.released).toEqual({ direct: 510654, staff: 522656, overhead: 0 });
    expect(ytd.receivedCents).toBe(0);
    // The next period starts from the frozen figures: 3,713.90.
    const next = await beginningBalance(orgId, opioidId, utcDate(2026, 9, 23));
    expect(next.beginningCents).toBe(371390);

    // Snapshotting again (a retried lock) writes nothing: the frozen rows stay the rows of record.
    expect(await snapshotLockedPeriod(orgId, lock.id)).toBe(0);
    expect((await grantPeriodSnapshots(orgId, opioidId)).filter((s) => s.name === 'FY2026 YTD')).toHaveLength(1);

    // A second lock sharing a day with an existing one is refused: it would count that day twice.
    await expect(lockPeriod(orgId, 'Q3 2026', utcDate(2026, 7, 1), utcDate(2026, 9, 30), '')).rejects.toThrow(
      /overlaps the existing lock "FY2026 YTD"/,
    );
    await expect(
      recordReportedPeriod(orgId, opioidId, {
        name: 'FY2025 again',
        periodFrom: utcDate(2025, 7, 1),
        periodTo: utcDate(2026, 1, 31),
        directCents: 0,
        staffCents: 0,
        overheadCents: 0,
        receivedCents: 0,
        note: 'overlaps',
      }),
    ).rejects.toMatchObject({
      fieldErrors: { periodFrom: expect.stringMatching(/Overlaps the existing period "FY2025"/) },
    });

    // Reopening removes the computed snapshot with the lock; a period of record cannot be reopened.
    await deletePeriodLock(orgId, lock.id);
    expect((await grantPeriodSnapshots(orgId, opioidId)).map((s) => s.name)).toEqual(['FY2025']);
    const fy2025 = await prisma.periodLock.findFirstOrThrow({ where: { orgId, name: 'FY2025' } });
    await expect(deletePeriodLock(orgId, fy2025.id)).rejects.toThrow(/reported figures/);
    expect(await prisma.grantPeriodSnapshot.count({ where: { periodLockId: fy2025.id } })).toBeGreaterThan(0);
  });
});

describe('reported-period entry (§6 H)', () => {
  it('re-reporting supersedes the earlier rows instead of deleting them', async () => {
    await recordReportedPeriod(orgId, opioidId, {
      name: 'FY2025',
      periodFrom: utcDate(2025, 1, 1),
      periodTo: utcDate(2025, 12, 31),
      directCents: 212000,
      staffCents: 83300,
      overheadCents: 300000,
      receivedCents: 2000000,
      note: 'Re-entered with the same figures.',
    });
    const active = await grantPeriodSnapshots(orgId, opioidId);
    expect(active).toHaveLength(1);
    expect(active[0]!.note).toBe('Re-entered with the same figures.');
    const all = await prisma.grantPeriodSnapshot.findMany({
      where: { grantId: opioidId },
    });
    expect(all).toHaveLength(8);
    expect(all.filter((s) => s.supersededAt).length).toBe(4);
    expect(await prisma.periodLock.count({ where: { orgId, name: 'FY2025' } })).toBe(1);
    const b = await beginningBalance(orgId, opioidId, FROM);
    expect(b.beginningCents).toBe(1404700);
  });

  it('rejects a period whose end precedes its start', async () => {
    await expect(
      recordReportedPeriod(orgId, opioidId, {
        name: 'Bad',
        periodFrom: utcDate(2025, 12, 31),
        periodTo: utcDate(2025, 1, 1),
        directCents: 0,
        staffCents: 0,
        overheadCents: 0,
        receivedCents: 0,
        note: 'x',
      }),
    ).rejects.toThrow();
  });
});
