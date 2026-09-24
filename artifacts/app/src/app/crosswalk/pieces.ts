import { prisma } from '@/lib/db';

export async function currentPieces(orgId: string, from?: Date, to?: Date) {
  const run = await prisma.computeRun.findFirst({ where: { orgId, isCurrent: true } });
  const pieces = run
    ? await prisma.allocatedLine.findMany({
        where: {
          orgId,
          computeRunId: run.id,
          ...(from && to
            ? { sourceLine: { transaction: { txnDate: { gte: from, lte: to } } } }
            : {}),
        },
        include: {
          sourceLine: { include: { account: true, transaction: true } },
          program: true,
          grantBudgetLine: { include: { grant: true } },
        },
        orderBy: { sourceLine: { transaction: { txnDate: 'asc' } } },
      })
    : [];
  return { run, pieces };
}
