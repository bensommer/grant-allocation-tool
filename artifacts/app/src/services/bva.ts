import { prisma } from '@/lib/db';
import { pacing, isOverBudget } from '@/domain/pacing';
import { matchesReceived } from '@/domain/received';
import { getPacingSettings } from './settings';

export function reportDate(raw?: string) {
  const date = raw ?? new Date().toISOString().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || new Date(date).toISOString().slice(0, 10) !== date)
    throw new Error('Invalid as-of date; expected YYYY-MM-DD');
  return { label: date, date: new Date(`${date}T00:00:00.000Z`) };
}

export async function bvaData(orgId: string, asOf: Date, grantId?: string) {
  const [run, grants, thresholds] = await Promise.all([
    prisma.computeRun.findFirst({ where: { orgId, isCurrent: true } }),
    prisma.grant.findMany({
      where: { orgId, ...(grantId ? { id: grantId } : { status: { not: 'archived' as const } }) },
      include: { budgetLines: { orderBy: [{ sortOrder: 'asc' }, { code: 'asc' }] } },
      orderBy: { name: 'asc' },
    }),
    getPacingSettings(orgId),
  ]);
  const [pieces, receipts] = await Promise.all([
    run
      ? prisma.allocatedLine.findMany({
          where: {
            orgId,
            computeRunId: run.id,
            status: 'ok',
            grantBudgetLineId: { not: null },
            ...(grantId ? { grantBudgetLine: { grantId } } : {}),
            sourceLine: {
              account: { type: { in: ['Expense', 'COGS', 'OtherExpense'] } },
              transaction: { orgId, deletedAt: null, txnDate: { lte: asOf } },
            },
          },
          select: {
            grantBudgetLineId: true,
            amountCents: true,
            sourceLine: { select: { transaction: { select: { txnDate: true } } } },
          },
        })
      : [],
    prisma.transactionLine.findMany({
      where: {
        orgId,
        account: { type: { in: ['Income', 'OtherIncome'] } },
        transaction: { orgId, deletedAt: null, txnDate: { lte: asOf } },
      },
      select: {
        accountId: true,
        classId: true,
        partyId: true,
        amountCents: true,
        account: { select: { type: true } },
        transaction: { select: { txnDate: true, partyId: true } },
      },
    }),
  ]);
  return {
    run,
    grants: grants.map((grant) => {
      const rows = grant.budgetLines.map((line) => {
        const applicable = pieces.filter(
          (p) =>
            p.grantBudgetLineId === line.id &&
            p.sourceLine.transaction.txnDate >= grant.startDate &&
            p.sourceLine.transaction.txnDate <= grant.endDate,
        );
        const actual = applicable.reduce((n, p) => n + p.amountCents, 0);
        const monthly: Record<string, number> = {};
        for (const p of applicable) {
          const month = p.sourceLine.transaction.txnDate.toISOString().slice(0, 7);
          monthly[month] = (monthly[month] ?? 0) + p.amountCents;
        }
        return {
          ...line,
          actual,
          remaining: line.budgetCents - actual,
          overBudget: isOverBudget(actual, line.budgetCents),
          monthly,
        };
      });
      const actual = rows.reduce((n, r) => n + r.actual, 0);
      const budget = rows.reduce((n, r) => n + r.budgetCents, 0);
      const received = receipts
        .filter(
          (r) =>
            r.transaction.txnDate >= grant.startDate &&
            r.transaction.txnDate <= grant.endDate &&
            matchesReceived(grant, {
              accountId: r.accountId,
              accountType: r.account.type,
              classId: r.classId,
              transactionPartyId: r.transaction.partyId,
              linePartyId: r.partyId,
            }),
        )
        .reduce((n, r) => n + r.amountCents, 0);
      const pace = pacing(
        grant.awardAmountCents,
        actual,
        grant.startDate,
        grant.endDate,
        asOf,
        thresholds.underPercent,
        thresholds.overPercent,
      );
      return {
        ...grant,
        rows,
        actual,
        budget,
        remaining: budget - actual,
        received,
        balance: received - actual,
        pace,
        flagged:
          (grant.restrictionType !== 'unrestricted' && pace.flag !== 'on pace') ||
          rows.some((r) => r.overBudget),
      };
    }),
  };
}
