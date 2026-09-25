import { prisma } from '@/lib/db';
import { allGrantFigures, lastImportedTransactionDate } from '@/services/grant-figures';

export { lastImportedTransactionDate };

export async function defaultReportDate(orgId: string, raw?: string) {
  const coverage = await lastImportedTransactionDate(orgId);
  return { ...reportDate(raw, coverage ?? undefined), coverage };
}

export function reportDate(raw?: string, fallback?: Date) {
  const date = raw ?? (fallback ?? new Date()).toISOString().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || new Date(date).toISOString().slice(0, 10) !== date)
    throw new Error('Invalid as-of date; expected YYYY-MM-DD');
  return { label: date, date: new Date(`${date}T00:00:00.000Z`) };
}

/**
 * Budget-vs-actual and restricted-balance rows for the report pages. Since JPH-30
 * this is a view over `grantFigures`: a membership-tracked grant's rows carry the
 * member-line spend, a crosswalk-tracked grant's rows the crosswalk pieces, and
 * received / balance / pace are the same numbers the grant overview shows.
 */
export async function bvaData(orgId: string, asOf: Date, grantId?: string) {
  const [run, all] = await Promise.all([
    prisma.computeRun.findFirst({ where: { orgId, isCurrent: true } }),
    allGrantFigures(orgId, asOf, grantId),
  ]);
  return {
    run,
    grants: all.map(({ grant, mode, figures }) => {
      const byId = new Map(figures.spentByBudgetLine.map((l) => [l.id, l]));
      const rows = grant.budgetLines.map((line) => {
        const f = byId.get(line.id)!;
        return {
          ...line,
          budgetCents: f.budgetCents,
          actual: f.chargedCents,
          remaining: f.remainingCents,
          overBudget: f.overBudget,
          monthly: f.monthly,
        };
      });
      return {
        ...grant,
        mode,
        figures,
        rows,
        actual: figures.spentCents,
        budget: figures.budgetCents,
        remaining: figures.budgetCents - figures.spentCents,
        received: figures.receivedCents,
        balance: figures.restrictedBalanceCents,
        pace: figures.pacing,
        flagged: figures.flagged,
      };
    }),
  };
}
