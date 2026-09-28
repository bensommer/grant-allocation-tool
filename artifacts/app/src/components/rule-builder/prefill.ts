/**
 * Prefill for the two `/new` routes (JPH-26 B5). Coverage's "Create rule" link and Phase C's
 * "Always do this" pass the ids of the transaction they came from; unknown ids are ignored
 * rather than rendered as phantom conditions. Returns null when nothing usable was passed, so
 * a plain `/new` stays a blank form.
 */
import { emptyRuleValues, type RuleFormValues, type RuleKind } from '@/lib/rule-form';
import type { BuilderOptions } from './types';

export interface PrefillParams {
  accountId?: string;
  partyId?: string;
  classId?: string;
  programId?: string;
  descriptionContains?: string;
  targetBudgetLineId?: string;
  activityId?: string;
  categoryKey?: string;
  decides?: string;
}

const known = (xs: Array<{ id: string }> | undefined, id: string | undefined) =>
  id && xs?.some((x) => x.id === id) ? [id] : [];

export function prefillValues(
  kind: RuleKind,
  options: BuilderOptions,
  p: PrefillParams,
): RuleFormValues | null {
  const v = emptyRuleValues(kind);
  let any = false;
  const mark = <T>(x: T, used: boolean): T => {
    if (used) any = true;
    return x;
  };
  v.accountIds = mark(known(options.accounts, p.accountId), !!p.accountId);
  v.partyIds = mark(known(options.parties, p.partyId), !!p.partyId);
  v.classIds = mark(known(options.classes, p.classId), !!p.classId);
  if (kind === 'crosswalk')
    v.programIds = mark(known(options.programs, p.programId), !!p.programId);
  if (p.descriptionContains) v.descriptionContains = mark(p.descriptionContains.trim(), true);
  if (kind === 'crosswalk') {
    const lines = (options.grants ?? []).flatMap((g) => g.lines);
    v.grantBudgetLineId = mark(known(lines, p.targetBudgetLineId)[0] ?? '', !!p.targetBudgetLineId);
  } else {
    const decides =
      p.decides === 'activity' || p.decides === 'category' || p.decides === 'line'
        ? p.decides
        : p.activityId && !p.targetBudgetLineId
          ? 'activity'
          : p.categoryKey && !p.targetBudgetLineId
            ? 'category'
            : 'line';
    v.dimension = mark(decides, !!p.decides);
    v.grantBudgetLineId = mark(
      known(options.lines, p.targetBudgetLineId)[0] ?? '',
      !!p.targetBudgetLineId,
    );
    v.targetActivityId = mark(known(options.activities, p.activityId)[0] ?? '', !!p.activityId);
    v.targetCategoryKey = mark(known(options.categories, p.categoryKey)[0] ?? '', !!p.categoryKey);
  }
  return any ? v : null;
}
