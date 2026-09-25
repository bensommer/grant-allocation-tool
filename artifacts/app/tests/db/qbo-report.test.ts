import { readFileSync } from 'node:fs';
import path from 'node:path';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '@/lib/db';
import { runImport } from '@/datasource/import-service';
import { QboReportDataSource } from '@/datasource/qbo-report/adapter';
import { parseQboReport, type Cell } from '@/datasource/qbo-report/parser';
import { readReportGrid } from '@/datasource/qbo-report/read';
import { scopeSummary, syncRuleMemberships } from '@/services/grant-membership';
import { createTestOrg, resetDatabase } from './helpers';

/**
 * JPH-20 acceptance criteria against the anonymized pilot exports.
 * The figures below come from the ticket (AC1); never adjust them here.
 */
const pilot = path.resolve(__dirname, '../../fixtures/pilot');
const SALAH = 'salah-export.csv';
const OPIOID = 'opioid-export.csv';

const ORG = { companyName: 'Test Org', fiscalYearStartMonth: 1, currency: 'USD' };

async function loadRows(file: string): Promise<Cell[][]> {
  const grid = await readReportGrid(readFileSync(path.join(pilot, file)), file);
  return grid.rows;
}

async function importRows(orgId: string, grantId: string, file: string, rows: Cell[][]) {
  const report = parseQboReport(rows, { fileName: file });
  if (!report.dateRange) throw new Error(`${file}: no date range parsed`);
  const source = new QboReportDataSource({ report, fileName: file, sha256: 'test', org: ORG });
  const result = await runImport(orgId, source, report.dateRange, {
    scope: { grantId, dateFrom: report.dateRange.from, dateTo: report.dateRange.to },
  });
  return { report, result };
}

async function importPilot(orgId: string, grantId: string, file: string) {
  return importRows(orgId, grantId, file, await loadRows(file));
}

async function makeGrant(orgId: string, name: string) {
  return prisma.grant.create({
    data: {
      orgId,
      name,
      funder: `${name} funder`,
      startDate: new Date('2025-01-01T00:00:00Z'),
      endDate: new Date('2027-12-31T00:00:00Z'),
      awardAmountCents: 5_000_000,
    },
  });
}

/** Signed cents of a CSV amount cell ("1,234.56" / "-12.00"). */
function amountCellToCents(cell: Cell): number {
  const n = Number(String(cell ?? '').replace(/[,$\s]/g, ''));
  return Math.round(n * 100);
}
function centsToAmountCell(cents: number): string {
  return (cents / 100).toFixed(2);
}

/** Index of the first data line (a row whose Transaction date column is filled). */
function firstLineRowIndex(rows: Cell[][], dateCol: number, from = 0): number {
  for (let i = from; i < rows.length; i++) {
    const v = rows[i]?.[dateCol];
    if (typeof v === 'string' && /^\d{2}\/\d{2}\/\d{4}$/.test(v)) return i;
  }
  throw new Error('no data line found');
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

/**
 * Remove one data line and subtract its amount from every total row that
 * encloses it (and TOTAL), so the trimmed export still balances.
 */
function dropLine(rows: Cell[][], cols: Record<string, number>, victim: number): number {
  const amountCol = cols['Amount']!;
  const dateCol = cols['Transaction date']!;
  const amount = amountCellToCents(rows[victim]![amountCol]);
  rows.splice(victim, 1);
  const subtract = (row: Cell[]) => {
    row[amountCol] = centsToAmountCell(amountCellToCents(row[amountCol]) - amount);
  };
  let depth = 0;
  for (let i = victim; i < rows.length; i++) {
    const row = rows[i]!;
    const label = String(row[0] ?? '').trim();
    if (!label || /^\d{2}\/\d{2}\/\d{4}$/.test(String(row[dateCol] ?? ''))) continue;
    if (/^total$/i.test(label)) {
      subtract(row);
      break;
    }
    if (/^total for /i.test(label)) {
      if (depth > 0) depth--;
      else subtract(row);
    } else depth++;
  }
  return amount;
}

async function activeMemberLineIds(grantId: string): Promise<string[]> {
  const rows = await prisma.grantMembership.findMany({
    where: { grantId, supersededAt: null },
    select: { transactionLineId: true },
  });
  return rows.map((r) => r.transactionLineId).sort();
}

describe('JPH-20 QuickBooks report import', () => {
  let orgId: string;
  let salahGrantId: string;
  let opioidGrantId: string;

  beforeEach(async () => {
    await resetDatabase();
    orgId = await createTestOrg();
    salahGrantId = (await makeGrant(orgId, 'Salah Foundation grant')).id;
    opioidGrantId = (await makeGrant(orgId, 'Opioid prevention grant')).id;
  });
  afterAll(() => prisma.$disconnect());

  it('AC1: both pilot exports import, every "Total for" checksum passes, and the grant totals match the ticket', async () => {
    const salah = await importPilot(orgId, salahGrantId, SALAH);
    const opioid = await importPilot(orgId, opioidGrantId, OPIOID);

    for (const { report, result } of [salah, opioid]) {
      expect(result.status).toBe('succeeded');
      expect(result.errors).toEqual([]);
      expect(report.checksums.length).toBeGreaterThan(0);
      expect(report.checksums.filter((c) => !c.passed)).toEqual([]);
      const batch = await prisma.importBatch.findUniqueOrThrow({ where: { id: result.batchId } });
      expect(batch.sourceSystem).toBe('qbo_report');
      expect((batch.checksums as Array<{ passed: boolean }>).every((c) => c.passed === true)).toBe(
        true,
      );
    }

    const salahScope = await scopeSummary(prisma, orgId, {
      grantId: salahGrantId,
      dateFrom: salah.report.dateRange!.from,
      dateTo: salah.report.dateRange!.to,
    });
    expect(salahScope.expenseCents).toBe(2_270_881); // 22,708.81
    expect(salahScope.incomeCents).toBe(5_000_000); // 50,000.00

    const opioidScope = await scopeSummary(prisma, orgId, {
      grantId: opioidGrantId,
      dateFrom: opioid.report.dateRange!.from,
      dateTo: opioid.report.dateRange!.to,
    });
    expect(opioidScope.incomeCents).toBe(2_000_000); // 20,000.00
  });

  it('AC2: a copy with one line removed fails naming the Total row and commits nothing', async () => {
    const rows = await loadRows(SALAH);
    const cols = headerColumns(rows);
    const victim = firstLineRowIndex(rows, cols['Transaction date']!);
    const account = String(rows[victim - 1]?.[0] ?? '');
    rows.splice(victim, 1);

    const { result } = await importRows(orgId, salahGrantId, SALAH, rows);
    expect(result.status).toBe('failed');
    const mismatches = result.errors.filter((e) => e.code === 'checksum_mismatch');
    expect(mismatches.length).toBeGreaterThan(0);
    expect(mismatches[0]!.message).toContain(`Total for ${account}`);
    expect(mismatches.map((e) => e.row)).toContain(victim + 1); // total row moved up by one

    expect(await prisma.transaction.count({ where: { orgId } })).toBe(0);
    expect(await prisma.transactionLine.count({ where: { orgId } })).toBe(0);
    expect(await prisma.account.count({ where: { orgId } })).toBe(0);
    expect(await prisma.grantMembership.count({ where: { orgId } })).toBe(0);
    const batch = await prisma.importBatch.findUniqueOrThrow({ where: { id: result.batchId } });
    expect(batch.status).toBe('failed');
  });

  it('AC3: re-importing the same file gives 0 new / 0 changed / 0 removed', async () => {
    const first = await importPilot(orgId, salahGrantId, SALAH);
    expect(first.result.status).toBe('succeeded');
    const again = await importPilot(orgId, salahGrantId, SALAH);
    expect(again.result.status).toBe('succeeded');
    expect(again.result.counts.transactions).toMatchObject({ new: 0, changed: 0, deleted: 0 });
    expect(again.result.counts.transactions.unchanged).toBe(first.result.counts.transactions.new);
    expect(again.result.counts.accounts).toMatchObject({ new: 0, changed: 0, deleted: 0 });
    expect(await prisma.sourceRowVersion.count({ where: { orgId } })).toBe(0);
  });

  it('AC4: one added line and one changed amount gives exactly 1 new + 1 changed; other scopes are untouched', async () => {
    const opioid = await importPilot(orgId, opioidGrantId, OPIOID);
    const salah = await importPilot(orgId, salahGrantId, SALAH);
    expect(salah.result.status).toBe('succeeded');
    const opioidLinesBefore = await prisma.transactionLine.findMany({
      where: { orgId, transaction: { importBatchId: opioid.result.batchId } },
      select: {
        id: true,
        amountCents: true,
        deletedAt: true,
        transaction: { select: { deletedAt: true } },
      },
      orderBy: { id: 'asc' },
    });
    expect(opioidLinesBefore.length).toBeGreaterThan(0);

    // Edit: bump one line by +25.00 and add a −25.00 line in the same account so every
    // "Total for" row (and TOTAL) still balances.
    const rows = await loadRows(SALAH);
    const cols = headerColumns(rows);
    const amountCol = cols['Amount']!;
    const dateCol = cols['Transaction date']!;
    const target = firstLineRowIndex(rows, dateCol, cols['Transaction date']! + 12);
    const original = [...rows[target]!];
    rows[target]![amountCol] = centsToAmountCell(amountCellToCents(original[amountCol]) + 2_500);
    const added = [...original];
    added[amountCol] = centsToAmountCell(-2_500);
    added[cols['Description']!] = 'AC4 added line';
    rows.splice(target + 1, 0, added);

    const edited = await importRows(orgId, salahGrantId, SALAH, rows);
    expect(edited.result.errors).toEqual([]);
    expect(edited.result.status).toBe('succeeded');
    expect(edited.result.counts.transactions).toMatchObject({ new: 1, changed: 1, deleted: 0 });

    const opioidLinesAfter = await prisma.transactionLine.findMany({
      where: { id: { in: opioidLinesBefore.map((l) => l.id) } },
      select: {
        id: true,
        amountCents: true,
        deletedAt: true,
        transaction: { select: { deletedAt: true } },
      },
      orderBy: { id: 'asc' },
    });
    expect(opioidLinesAfter).toEqual(opioidLinesBefore);
    expect(
      await prisma.sourceRowVersion.count({
        where: { orgId, importBatchId: edited.result.batchId },
      }),
    ).toBe(1);
  });

  it('AC5: every Opioid line belongs to the Opioid grant regardless of class', async () => {
    const { result } = await importPilot(orgId, opioidGrantId, OPIOID);
    expect(result.status).toBe('succeeded');
    const lines = await prisma.transactionLine.findMany({
      where: { orgId, transaction: { importBatchId: result.batchId } },
      select: { id: true, class: { select: { name: true } } },
    });
    expect(lines.length).toBe(result.counts.lines);
    const memberIds = new Set(await activeMemberLineIds(opioidGrantId));
    for (const line of lines) expect(memberIds.has(line.id)).toBe(true);
    expect(memberIds.size).toBe(lines.length);

    const classNames = new Set(lines.map((l) => l.class?.name ?? null));
    for (const expected of [
      'Trauma Programs',
      'Youth Programs',
      'Camp',
      'Family & Community Programs',
      'Programs',
    ])
      expect(classNames.has(expected)).toBe(true);
    expect(await activeMemberLineIds(salahGrantId)).toEqual([]);
  });

  it('AC6: importing Salah, then Opioid, then Salah again never removes Opioid lines', async () => {
    await importPilot(orgId, salahGrantId, SALAH);
    const opioid = await importPilot(orgId, opioidGrantId, OPIOID);
    const opioidMembersBefore = await activeMemberLineIds(opioidGrantId);
    expect(opioidMembersBefore.length).toBe(opioid.result.counts.lines);

    const salahAgain = await importPilot(orgId, salahGrantId, SALAH);
    expect(salahAgain.result.status).toBe('succeeded');
    expect(salahAgain.result.counts.transactions).toMatchObject({ new: 0, changed: 0, deleted: 0 });

    expect(await activeMemberLineIds(opioidGrantId)).toEqual(opioidMembersBefore);
    expect(
      await prisma.transaction.count({
        where: { orgId, importBatchId: opioid.result.batchId, deletedAt: { not: null } },
      }),
    ).toBe(0);
    expect(
      await prisma.transactionLine.count({
        where: { orgId, id: { in: opioidMembersBefore }, deletedAt: { not: null } },
      }),
    ).toBe(0);
  });

  it("a line two grants both exported stays live when one grant's report later drops it", async () => {
    const full = await loadRows(SALAH);
    const cols = headerColumns(full);
    const victim = firstLineRowIndex(full, cols['Transaction date']!);
    await importRows(orgId, salahGrantId, SALAH, full);
    await importRows(orgId, opioidGrantId, SALAH, full);

    const trimmed = await loadRows(SALAH);
    const amount = dropLine(trimmed, cols, victim);
    const again = await importRows(orgId, salahGrantId, SALAH, trimmed);
    expect(again.result.errors).toEqual([]);
    expect(again.result.status).toBe('succeeded');
    expect(again.result.counts.transactions.deleted).toBe(1);

    const shared = await prisma.transaction.findFirstOrThrow({
      where: { orgId, sourceSystem: 'qbo_report', lines: { some: { amountCents: amount } } },
      include: { lines: { include: { memberships: { where: { supersededAt: null } } } } },
    });
    expect(shared.deletedAt).toBeNull();
    const grants = shared.lines.flatMap((l) => l.memberships.map((m) => m.grantId));
    expect(grants).toContain(opioidGrantId);
    expect(grants).not.toContain(salahGrantId);
    // The other grant's view is unchanged; this grant's lost the line.
    expect((await activeMemberLineIds(opioidGrantId)).length).toBe(
      (await activeMemberLineIds(salahGrantId)).length + 1,
    );
  });

  it("dropping a class rule keeps the membership the grant's own report established", async () => {
    // The classes exist because another grant's report brought the lines in first, so the
    // rule membership predates this grant's own import.
    await importPilot(orgId, salahGrantId, OPIOID);
    const someClass = await prisma.trackingClass.findFirstOrThrow({
      where: { orgId, sourceSystem: 'qbo_report' },
    });
    await prisma.grant.update({
      where: { id: opioidGrantId },
      data: { memberClassIds: [someClass.id] },
    });
    await syncRuleMemberships(prisma, orgId, opioidGrantId);
    expect((await activeMemberLineIds(opioidGrantId)).length).toBeGreaterThan(0);

    const opioid = await importPilot(orgId, opioidGrantId, OPIOID);
    const withRule = await activeMemberLineIds(opioidGrantId);
    expect(new Set(withRule).size).toBe(opioid.result.counts.lines);

    await prisma.grant.update({ where: { id: opioidGrantId }, data: { memberClassIds: [] } });
    await syncRuleMemberships(prisma, orgId, opioidGrantId);
    const afterDrop = await activeMemberLineIds(opioidGrantId);
    expect(new Set(afterDrop)).toEqual(new Set(withRule));
  });
});
