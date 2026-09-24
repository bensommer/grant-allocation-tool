import { prisma } from '@/lib/db';
import type { Dimension, ReportParams } from './params';

export type Fact = Record<Dimension, string> & {
  sourceLineId: string;
  pieceId: string;
  amountCents: number;
  date: string;
  doc: string;
  description: string;
  status: string;
};
export async function loadReport(orgId: string, p: ReportParams) {
  const startedAt = performance.now();
  const [org, run] = await Promise.all([
    prisma.org.findUniqueOrThrow({ where: { id: orgId } }),
    prisma.computeRun.findFirst({
      where: {
        orgId,
        ...(p.run ? { id: p.run } : { isCurrent: true }),
        status: { in: ['succeeded', 'superseded'] },
      },
    }),
  ]);
  if (!run) return { org, run: null, facts: [] as Fact[] };
  const lines = await prisma.allocatedLine.findMany({
    where: {
      orgId,
      computeRunId: run.id,
      ...(p.grant.length ? { grantId: { in: p.grant } } : {}),
      ...(p.program.length ? { programId: { in: p.program } } : {}),
      ...(p.restricted ? { grant: { restrictionType: { not: 'unrestricted' } } } : {}),
      ...(!p.unmapped
        ? { grantId: { not: null }, status: { not: 'crosswalk_conflict' as const } }
        : {}),
      sourceLine: {
        orgId,
        ...(p.account.length
          ? { accountId: { in: p.account } }
          : { account: { type: 'Expense' as const } }),
        transaction: {
          orgId,
          ...(p.from || p.to
            ? {
                txnDate: {
                  ...(p.from ? { gte: new Date(`${p.from}T00:00:00Z`) } : {}),
                  ...(p.to ? { lte: new Date(`${p.to}T00:00:00Z`) } : {}),
                },
              }
            : {}),
        },
      },
    },
    include: {
      grant: true,
      grantBudgetLine: true,
      program: true,
      sourceLine: {
        include: { account: true, class: true, transaction: { include: { party: true } } },
      },
    },
  });
  const facts: Fact[] = lines.map((l) => {
    const d = l.sourceLine.transaction.txnDate.toISOString().slice(0, 10);
    const month = d.slice(0, 7);
    const year = Number(d.slice(0, 4)),
      m = Number(d.slice(5, 7));
    const fiscalYear =
      year + (org.fiscalYearStartMonth > 1 && m >= org.fiscalYearStartMonth ? 1 : 0);
    const quarter = Math.floor(((m - org.fiscalYearStartMonth + 12) % 12) / 3) + 1;
    return {
      sourceLineId: l.sourceLineId,
      pieceId: l.id,
      amountCents: l.amountCents,
      date: d,
      doc: l.sourceLine.transaction.docNumber ?? '',
      description: l.sourceLine.description ?? l.sourceLine.transaction.memo ?? '',
      status: l.status,
      grant: l.grant?.awardNumber ?? l.grant?.name ?? 'Unmapped',
      grantBudgetLine: l.grantBudgetLine?.code ?? 'Unmapped',
      program: l.program?.code ?? 'Unassigned',
      functionalCategory: l.program?.functionalCategory ?? 'Unassigned',
      glAccount: `${l.sourceLine.account.number ?? ''} ${l.sourceLine.account.name}`.trim(),
      glAccountType: l.sourceLine.account.type,
      class: l.sourceLine.class?.name ?? 'Unassigned',
      month,
      quarter: `${fiscalYear}-Q${quarter}`,
    };
  });
  console.info(
    `Report query ${org.name}: ${facts.length} pieces in ${Math.round(performance.now() - startedAt)}ms`,
  );
  return { org, run, facts };
}
