/**
 * The figures behind the overview cards (JPH-28 D2: shared by /reports/overview and checklist
 * step 3 so the two never disagree). Pure derivation lives in src/domain/unmapped.ts; this file
 * only loads the current calculation's allocations for the stated period.
 */
import { EXPENSE_ACCOUNT_TYPES, unmappedProgramExpense } from '@/domain/unmapped';
import type { YearMonth } from '@/domain/format';
import { prisma } from '@/lib/db';
import type { CurrentPeriod } from '@/lib/period';
import { bvaData } from '@/services/bva';
import { describeUnmapped } from '@/services/reconciliation';

export interface StoredCheck {
  name: string;
  status?: string;
  ok: boolean;
  href?: string;
  detail?: string;
  cents?: number;
  transactions?: number;
}

export type DashboardData = Awaited<ReturnType<typeof dashboardData>>;

export async function dashboardData(orgId: string, period: CurrentPeriod) {
  const { date, range } = period;
  const [{ run, grants }, lastImport] = await Promise.all([
    bvaData(orgId, date),
    prisma.importBatch.findFirst({ where: { orgId }, orderBy: { startedAt: 'desc' } }),
  ]);
  const flagged = grants.filter((g) => g.flagged);
  const restricted = grants.filter((g) => g.restrictionType !== 'unrestricted');
  const storedChecks = (run?.checks ?? []) as unknown as StoredCheck[];
  // Expense allocated inside the period this page states (fiscal year start – as-of), the
  // same window /crosswalk/coverage defaults to, so the two pages' figures agree.
  const expenses = run
    ? await prisma.allocatedLine.findMany({
        where: {
          orgId,
          computeRunId: run.id,
          status: 'ok',
          sourceLine: {
            account: { type: { in: [...EXPENSE_ACCOUNT_TYPES] } },
            transaction: { orgId, deletedAt: null, txnDate: { gte: range.from, lte: range.to } },
          },
        },
        select: {
          amountCents: true,
          programId: true,
          grantBudgetLineId: true,
          status: true,
          program: { select: { name: true, code: true, functionalCategory: true } },
          sourceLine: {
            select: {
              transactionId: true,
              account: { select: { type: true } },
              transaction: { select: { txnDate: true } },
            },
          },
        },
      })
    : [];
  // One definition of unmapped (src/domain/unmapped.ts), shared with the reconciliation
  // check and the coverage total.
  const unmappedSummary = unmappedProgramExpense(expenses, range);
  const unmapped = unmappedSummary.pieces;
  const nonGrant = expenses.filter(
    (p) => p.program?.functionalCategory !== 'program' && p.program !== null,
  );
  // The stored check covers [fiscal year start, books through]; when the page shows an
  // earlier as-of, re-derive it for that period with the same predicate so the card, the
  // check and coverage never disagree.
  const checks: StoredCheck[] = storedChecks.map((c) =>
    c.name === 'unmapped_program_expense'
      ? {
          ...c,
          status: unmapped.length ? 'warn' : 'pass',
          ok: true,
          detail: describeUnmapped(unmappedSummary, range),
          cents: unmappedSummary.cents,
          transactions: unmappedSummary.transactions,
        }
      : c,
  );
  const group = (items: typeof expenses) => {
    const totals = new Map<string, { name: string; code: string; cents: number }>();
    for (const item of items) {
      if (!item.programId || !item.program) continue;
      const previous = totals.get(item.programId);
      totals.set(item.programId, {
        name: item.program.name,
        code: item.program.code,
        cents: (previous?.cents ?? 0) + item.amountCents,
      });
    }
    return [...totals.values()];
  };
  const monthly = new Map<YearMonth, number>();
  for (const item of expenses) {
    const month = item.sourceLine.transaction.txnDate.toISOString().slice(0, 7) as YearMonth;
    monthly.set(month, (monthly.get(month) ?? 0) + item.amountCents);
  }
  const months = [...monthly.keys()].sort() as YearMonth[];
  return {
    run,
    grants,
    lastImport,
    flagged,
    restricted,
    restrictedTotalCents: restricted.reduce((n, g) => n + g.balance, 0),
    unmappedSummary,
    unmappedByProgram: group(unmapped),
    nonGrantCents: nonGrant.reduce((n, p) => n + p.amountCents, 0),
    nonGrantByProgram: group(nonGrant),
    checks: checks.filter((c) => c.name !== 'stats'),
    monthly,
    months,
  };
}
