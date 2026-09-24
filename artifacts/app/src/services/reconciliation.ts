import { prisma } from '@/lib/db';
import type { SourceTrialBalance } from '@/datasource/types';

export type ReconciliationCheck = {
  name: string;
  status: 'pass' | 'warn' | 'fail';
  ok: boolean;
  detail: string;
  href: string;
};

export async function reconciliationChecks(
  orgId: string,
  runId: string,
): Promise<ReconciliationCheck[]> {
  const [run, batch, pieces, income, grants] = await Promise.all([
    prisma.computeRun.findFirstOrThrow({ where: { id: runId, orgId } }),
    prisma.importBatch.findFirst({
      where: { orgId, status: 'succeeded' },
      orderBy: { startedAt: 'desc' },
    }),
    prisma.allocatedLine.findMany({
      where: {
        orgId,
        computeRunId: runId,
      },
      select: {
        amountCents: true,
        programId: true,
        grantBudgetLineId: true,
        status: true,
        sourceLine: { select: { account: { select: { type: true } } } },
      },
    }),
    prisma.transactionLine.findMany({
      where: {
        orgId,
        deletedAt: null,
        transaction: { deletedAt: null },
        account: { type: { in: ['Income', 'OtherIncome'] } },
      },
      select: { transaction: { select: { txnDate: true, partyId: true } } },
    }),
    prisma.grant.findMany({
      where: { orgId },
      select: { name: true, funderPartyId: true, startDate: true, endDate: true },
    }),
  ]);
  const check = (
    name: string,
    status: ReconciliationCheck['status'],
    detail: string,
    href: string,
  ): ReconciliationCheck => ({
    name,
    status,
    ok: status !== 'fail',
    detail,
    href,
  });
  const result = [
    check(
      'sum_per_source_line',
      'pass',
      `${pieces.length} allocation pieces balanced`,
      `/runs/${run.id}`,
    ),
  ];
  const balances = ((batch?.counts as Record<string, unknown> | undefined)?.trialBalance ??
    []) as SourceTrialBalance[];
  if (!balances.length) {
    result.push(
      check(
        'trial_balance',
        'warn',
        'Not provided: trial_balance.csv',
        `/import/${batch?.id ?? ''}`,
      ),
    );
  } else {
    const mismatches: string[] = [];
    const periodEnd = [...balances.map((b) => b.periodEnd)].sort().at(-1)!;
    const activeAccounts = await prisma.transactionLine.groupBy({
      by: ['accountId'],
      where: {
        orgId,
        deletedAt: null,
        account: { type: { in: ['Expense', 'COGS', 'OtherExpense'] } },
        transaction: {
          deletedAt: null,
          txnDate: {
            gte: new Date(`${periodEnd.slice(0, 4)}-01-01T00:00:00Z`),
            lte: new Date(`${periodEnd}T00:00:00Z`),
          },
        },
      },
    });
    const covered = new Set<string>();
    for (const balance of balances) {
      const account = await prisma.account.findFirst({
        where: { orgId, sourceSystem: batch!.sourceSystem, externalId: balance.accountExternalId },
      });
      if (!account) {
        mismatches.push(`${balance.accountExternalId}: account not found`);
        continue;
      }
      covered.add(account.id);
      const actual = await prisma.transactionLine.aggregate({
        where: {
          orgId,
          deletedAt: null,
          accountId: account.id,
          transaction: {
            deletedAt: null,
            txnDate: {
              gte: new Date(`${balance.periodEnd.slice(0, 4)}-01-01T00:00:00Z`),
              lte: new Date(`${balance.periodEnd}T00:00:00Z`),
            },
          },
        },
        _sum: { amountCents: true },
      });
      if ((actual._sum.amountCents ?? 0) !== balance.balanceCents)
        mismatches.push(
          `${balance.accountExternalId} (${account.name}): mirror ${actual._sum.amountCents ?? 0} cents vs trial balance ${balance.balanceCents} cents`,
        );
    }
    result.push(
      check(
        'trial_balance',
        mismatches.length
          ? 'fail'
          : activeAccounts.some((a) => !covered.has(a.accountId))
            ? 'warn'
            : 'pass',
        [
          `${activeAccounts.filter((a) => covered.has(a.accountId)).length} of ${activeAccounts.length} expense accounts covered`,
          ...mismatches,
        ].join('; '),
        `/import/${batch!.id}`,
      ),
    );
  }
  const unassigned = pieces.filter((p) => !p.programId).length;
  result.push(
    check(
      'unassigned_program',
      unassigned ? 'warn' : 'pass',
      `${unassigned} allocation pieces without program`,
      '/programs',
    ),
  );
  const expensePieces = pieces.filter((p) =>
    ['Expense', 'COGS', 'OtherExpense'].includes(p.sourceLine.account.type),
  );
  const unmapped = expensePieces.filter(
    (p) => p.programId && !p.grantBudgetLineId && p.status === 'ok',
  ).length;
  result.push(
    check(
      'unmapped_program_expense',
      unmapped ? 'warn' : 'pass',
      `${unmapped} unmapped pieces`,
      '/crosswalk/coverage',
    ),
  );
  const conflicts = expensePieces.filter((p) => p.status === 'crosswalk_conflict').length;
  result.push(
    check(
      'crosswalk_conflicts',
      conflicts ? 'fail' : 'pass',
      `${conflicts} conflicting pieces`,
      '/crosswalk/coverage',
    ),
  );
  const outside = grants.flatMap((g) =>
    income
      .filter(
        (l) =>
          g.funderPartyId &&
          l.transaction.partyId === g.funderPartyId &&
          (l.transaction.txnDate < g.startDate || l.transaction.txnDate > g.endDate),
      )
      .map(() => g.name),
  );
  result.push(
    check(
      'grant_revenue_sanity',
      outside.length ? 'warn' : 'pass',
      outside.length
        ? `Outside grant period: ${outside.join(', ')}`
        : 'No out-of-period funder income',
      '/grants',
    ),
  );
  return result;
}
