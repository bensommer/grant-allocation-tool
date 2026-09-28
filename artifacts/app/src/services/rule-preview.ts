/**
 * Preview for the rule builder (JPH-26 B2/B3): count, total and the first ten matching
 * transactions in the app period, for a crosswalk rule or a grant rule. Both entry points — the
 * no-JS Preview button and POST /api/rules/preview — call this with the same parsed form values,
 * and both engines are the real ones (src/engine/preview.ts, services/grant-rules.ts).
 */
import type { RulePreviewData } from '@/components/rule-builder/types';
import { formatPeriod } from '@/domain/format';
import { matchersSchema, type Matchers } from '@/domain/matchers';
import type { DateRange } from '@/domain/period';
import { prisma } from '@/lib/db';
import {
  DEFAULT_NEW_PRIORITY,
  matchersFromValues,
  type RuleFormValues,
  type RuleKind,
} from '@/lib/rule-form';
import { previewRule } from '@/engine/preview';
import { previewGrantRule } from '@/services/grant-rules';
import { supersetWarning } from '@/services/rule-superset';

export const PREVIEW_ROWS = 10;

export interface PreviewRequest {
  kind: RuleKind;
  values: RuleFormValues;
  range: DateRange;
  grantId?: string;
  ruleId?: string;
}

/** Form values → matchers; a half-typed form previews as "no conditions" instead of throwing. */
export function previewMatchers(values: RuleFormValues, kind: RuleKind): Matchers {
  const parsed = matchersSchema.safeParse(matchersFromValues(values, kind));
  return parsed.success ? parsed.data : {};
}

export function previewPriority(values: RuleFormValues): number {
  const n = Number(values.priority);
  return values.priority !== '' && Number.isFinite(n) ? n : DEFAULT_NEW_PRIORITY;
}

async function rowsFor(lineIds: string[], amounts?: Map<string, number>) {
  const lines = await prisma.transactionLine.findMany({
    where: { id: { in: lineIds } },
    include: {
      account: { select: { name: true, number: true } },
      party: { select: { displayName: true } },
      transaction: {
        select: { txnDate: true, memo: true, party: { select: { displayName: true } } },
      },
    },
  });
  const byId = new Map(lines.map((l) => [l.id, l]));
  return lineIds.flatMap((id) => {
    const l = byId.get(id);
    if (!l) return [];
    return [
      {
        id: l.id,
        date: l.transaction.txnDate.toISOString(),
        name: l.party?.displayName ?? l.transaction.party?.displayName ?? null,
        account: l.account.number ? `${l.account.number} ${l.account.name}` : l.account.name,
        description: l.description ?? l.transaction.memo,
        amountCents: amounts?.get(id) ?? l.amountCents,
      },
    ];
  });
}

export async function previewRuleForm(
  orgId: string,
  req: PreviewRequest,
): Promise<RulePreviewData> {
  const { values, range } = req;
  const matchers = previewMatchers(values, req.kind);
  const priority = previewPriority(values);
  const periodLabel = formatPeriod(range.from, range.to);

  if (req.kind === 'crosswalk') {
    const candidate = {
      kind: 'crosswalk' as const,
      matchers,
      grantBudgetLineId: values.grantBudgetLineId || null,
      priority,
      ...(req.ruleId ? { ruleId: req.ruleId } : {}),
    };
    const [result, warning] = await Promise.all([
      previewRule(orgId, candidate, range, PREVIEW_ROWS),
      supersetWarning(orgId, candidate, range),
    ]);
    return {
      count: result.count,
      totalCents: result.totalCents,
      rows: result.sample.map((s) => ({
        id: s.sourceLineId,
        date: s.txnDate.toISOString(),
        name: s.party,
        account: s.account,
        description: s.description,
        amountCents: s.amountCents,
      })),
      periodLabel,
      warning,
    };
  }

  if (!req.grantId) throw new Error('grant rule preview needs a grantId');
  const d = values.dimension;
  const candidate = {
    grantId: req.grantId,
    dimension: d,
    matchers,
    priority,
    grantBudgetLineId: d === 'line' ? values.grantBudgetLineId || null : null,
    targetActivityId: d === 'activity' ? values.targetActivityId || null : null,
    targetCategoryKey: d === 'category' ? values.targetCategoryKey || null : null,
    ...(req.ruleId ? { ruleId: req.ruleId } : {}),
  };
  const [result, warning] = await Promise.all([
    previewGrantRule(orgId, req.grantId, candidate),
    supersetWarning(orgId, candidate, range),
  ]);
  // The grant stage decides every member line; the panel reports the app period only.
  const inPeriod = await prisma.transactionLine.findMany({
    where: {
      id: { in: result.lineIds },
      transaction: { txnDate: { gte: range.from, lte: range.to } },
    },
    select: { id: true, amountCents: true, transaction: { select: { txnDate: true } } },
    orderBy: [{ transaction: { txnDate: 'asc' } }, { id: 'asc' }],
  });
  return {
    count: inPeriod.length,
    totalCents: inPeriod.reduce((a, l) => a + l.amountCents, 0),
    rows: await rowsFor(inPeriod.slice(0, PREVIEW_ROWS).map((l) => l.id)),
    periodLabel,
    warning,
  };
}
