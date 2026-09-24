import { formatPct1 } from '@/domain/money';
import { bvaData } from '@/services/bva';
import { loadReport } from '@/reports/query';
import { reportSchema } from '@/reports/params';

export async function buildPacket(
  orgId: string,
  grantId: string,
  from: string,
  to: string,
  contextNotes: string,
) {
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(from) ||
    !/^\d{4}-\d{2}-\d{2}$/.test(to) ||
    from > to ||
    new Date(from).toISOString().slice(0, 10) !== from ||
    new Date(to).toISOString().slice(0, 10) !== to
  )
    throw new Error('Enter a valid period.');
  const { run, grants } = await bvaData(orgId, new Date(`${to}T00:00:00Z`), grantId);
  const grant = grants[0];
  if (!grant) throw new Error('Grant not found.');
  if (!run) throw new Error('Recompute before drafting a narrative.');
  if (
    from < grant.startDate.toISOString().slice(0, 10) ||
    to > grant.endDate.toISOString().slice(0, 10)
  )
    throw new Error('Period must fall within the grant dates.');
  const report = await loadReport(
    orgId,
    reportSchema.parse({ grant: [grantId], from, to, run: run.id }),
  );
  const rows = grant.rows.map((r) => {
    const facts = report.facts.filter((f) => f.grantBudgetLine === r.code && f.status === 'ok');
    const actual = facts.reduce((sum, f) => sum + f.amountCents, 0);
    const monthly: Record<string, number> = {};
    for (const f of facts)
      monthly[f.date.slice(0, 7)] = (monthly[f.date.slice(0, 7)] ?? 0) + f.amountCents;
    return {
      code: r.code,
      name: r.name,
      budgetCents: r.budgetCents,
      actualCents: actual,
      remainingCents: r.budgetCents - actual,
      monthly,
      // Sub-totals a writer would naturally cite: per GL account and per vendor within the line.
      byAccount: sumBy(facts, (f) => f.glAccount),
      byVendor: sumBy(facts, (f) => f.vendor ?? 'Unknown'),
      contributors: facts
        .sort((a, b) => Math.abs(b.amountCents) - Math.abs(a.amountCents))
        .slice(0, 10)
        .map((f) => ({
          description: f.description,
          vendor: f.vendor,
          doc: f.doc,
          date: f.date,
          amountCents: f.amountCents,
        })),
    };
  });
  const actual = rows.reduce((sum, r) => sum + r.actualCents, 0);
  const budget = rows.reduce((sum, r) => sum + r.budgetCents, 0);
  const derived: { currency: Record<string, number>; percentage: Record<string, number> } = {
    currency: {
      'period.total.actual': actual,
      'period.total.remaining': budget - actual,
      'itd.pace.variance': grant.pace.varianceCents,
      'itd.balance': grant.balance,
      'itd.received': grant.received,
      'itd.spent': grant.actual,
      'grant.budget': budget,
      'grant.award': grant.awardAmountCents,
      'itd.pace.expected': grant.pace.expectedCents,
    },
    percentage: {
      'period.total.pctUsed': Number(formatPct1(actual, budget).replace('%', '')),
      'itd.pace.variancePct': Number(grant.pace.variancePct.replace('%', '')),
      'itd.pace.elapsedPct': Number(
        formatPct1(grant.pace.elapsedDays, grant.pace.totalDays).replace('%', ''),
      ),
      'itd.pace.receivedPctOfAward': Number(
        formatPct1(grant.received, grant.awardAmountCents).replace('%', ''),
      ),
    },
  };
  for (const r of rows) {
    derived.currency[`period.${r.code}.actual`] = r.actualCents;
    derived.currency[`period.${r.code}.budget`] = r.budgetCents;
    derived.currency[`period.${r.code}.remaining`] = r.remainingCents;
    derived.currency[`period.${r.code}.variance`] = r.actualCents - r.budgetCents;
    derived.percentage[`period.${r.code}.pctUsed`] = Number(
      formatPct1(r.actualCents, r.budgetCents).replace('%', ''),
    );
    for (const [month, value] of Object.entries(r.monthly))
      derived.currency[`period.${r.code}.${month}`] = value;
    r.contributors.forEach((f, i) => {
      derived.currency[`period.${r.code}.contributor.${i}`] = f.amountCents;
    });
    for (const [k, v] of Object.entries(r.byAccount))
      derived.currency[`period.${r.code}.account.${k}`] = v;
    for (const [k, v] of Object.entries(r.byVendor))
      derived.currency[`period.${r.code}.vendor.${k}`] = v;
  }
  return {
    computeRunId: run.id,
    grant: {
      id: grant.id,
      name: grant.name,
      awardNumber: grant.awardNumber,
      funder: grant.funder,
      restrictionType: grant.restrictionType,
    },
    period: { from, to },
    contextNotes,
    rows,
    inceptionToDate: {
      asOf: to,
      spentCents: grant.actual,
      receivedCents: grant.received,
      restrictedBalanceCents: grant.balance,
      pace: grant.pace,
    },
    derived,
  };
}
function sumBy<T extends { amountCents: number }>(items: T[], key: (t: T) => string) {
  const out: Record<string, number> = {};
  for (const it of items) out[key(it)] = (out[key(it)] ?? 0) + it.amountCents;
  return out;
}
export type GroundingPacket = Awaited<ReturnType<typeof buildPacket>>;
