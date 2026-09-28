/** Server side of the rule form: validates the read values against the service schemas. */
import { zodErrors } from '@/lib/zod-errors';
import { crosswalkInputSchema, type CrosswalkInput } from '@/services/crosswalk';
import { grantRuleInputSchema, type GrantRuleInput } from '@/services/grant-rules';
import {
  DEFAULT_NEW_PRIORITY,
  matchersFromValues,
  readRuleValues,
  type FormReader,
  type RuleFormValues,
  type RuleKind,
} from './rule-form';

export type ParsedRuleForm =
  | {
      kind: 'crosswalk';
      values: RuleFormValues;
      data: CrosswalkInput | null;
      errors: Record<string, string>;
    }
  | {
      kind: 'grant';
      values: RuleFormValues;
      data: GrantRuleInput | null;
      errors: Record<string, string>;
    };

/**
 * Validates the form for saving. `suggestedName` fills a blank name (the sentence, ≤ 80 chars),
 * so the name field is optional in the UI.
 */
export function parseRuleForm(
  r: FormReader,
  kind: RuleKind,
  suggestedName?: string,
): ParsedRuleForm {
  const values = readRuleValues(r, kind);
  const matchers = matchersFromValues(values, kind);
  const name = values.name || suggestedName || '';
  const priority = values.priority === '' ? DEFAULT_NEW_PRIORITY : Number(values.priority);
  const errors: Record<string, string> = {};
  const { accountFrom: from, accountTo: to } = values;
  if ((from && !to) || (!from && to)) errors['accountRange'] = 'Enter both range endpoints';
  if (
    from &&
    to &&
    from > to &&
    !(Number.isFinite(Number(from)) && Number.isFinite(Number(to)) && Number(from) <= Number(to))
  )
    errors['accountRange'] = 'Range start must be before end';
  if (values.dateFrom && values.dateTo && values.dateFrom > values.dateTo)
    errors['matchers.dateTo'] = 'End date must be on or after start';

  if (kind === 'crosswalk') {
    const result = crosswalkInputSchema.safeParse({
      name,
      grantBudgetLineId: values.grantBudgetLineId,
      priority,
      active: values.active,
      matchers,
    });
    if (!result.success) Object.assign(errors, zodErrors(result.error));
    return { kind, values, data: result.success ? result.data : null, errors };
  }
  const d = values.dimension;
  const result = grantRuleInputSchema.safeParse({
    name,
    dimension: d,
    grantBudgetLineId: d === 'line' ? values.grantBudgetLineId || null : null,
    targetActivityId: d === 'activity' ? values.targetActivityId || null : null,
    targetCategoryKey: d === 'category' ? values.targetCategoryKey || null : null,
    priority,
    active: values.active,
    matchers,
  });
  if (!result.success) Object.assign(errors, zodErrors(result.error));
  return { kind, values, data: result.success ? result.data : null, errors };
}
