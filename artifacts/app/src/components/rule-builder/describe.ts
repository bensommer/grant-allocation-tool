/**
 * Form values → sentence (JPH-26 B1/B2). Plain TypeScript with no server or client dependencies,
 * so the server pages, the server actions and the island all render the same words.
 */
import { describeRule, suggestRuleName, type RuleTarget } from '@/domain/describe-rule';
import { matchersSchema } from '@/domain/matchers';
import { matchersFromValues, type RuleFormValues, type RuleKind } from '@/lib/rule-form';
import { labelsFromOptions, type BuilderOption, type BuilderOptions } from './types';

function targetOf(v: RuleFormValues, kind: RuleKind, o: BuilderOptions): RuleTarget {
  if (kind === 'crosswalk') {
    for (const g of o.grants ?? []) {
      const line = g.lines.find((l) => l.id === v.grantBudgetLineId);
      if (line)
        return { kind: 'crosswalk', grant: g.name, budgetLine: line.label.replace(/^.*? — /, '') };
    }
    return null;
  }
  const find = (xs: BuilderOption[] | undefined, id: string) => xs?.find((x) => x.id === id);
  if (v.dimension === 'line') {
    const l = find(o.lines, v.grantBudgetLineId);
    return l ? { kind: 'line', name: l.label.replace(/^.*? — /, '') } : null;
  }
  if (v.dimension === 'activity') {
    const a = find(o.activities, v.targetActivityId);
    return a ? { kind: 'activity', name: a.label } : null;
  }
  const c = find(o.categories, v.targetCategoryKey);
  return c ? { kind: 'category', name: c.label } : null;
}

/** Sentence + suggested name for the current values; shared by the server pages and the island. */
export function describeValues(
  v: RuleFormValues,
  kind: RuleKind,
  o: BuilderOptions,
  grantName?: string,
) {
  const parsed = matchersSchema.safeParse(matchersFromValues(v, kind));
  const d = describeRule({
    scope: kind === 'crosswalk' ? 'all' : { grant: grantName ?? '' },
    matchers: parsed.success ? parsed.data : {},
    target: targetOf(v, kind, o),
    labels: labelsFromOptions(o),
  });
  // Name suggestion: the sentence, minus the "(choose a target)" placeholder while unset.
  const hasTarget = d.target !== '(choose a target)';
  const suggested =
    d.conditions.length > 0 || hasTarget
      ? suggestRuleName(hasTarget ? d.sentence : d.sentence.replace(/ → \(choose a target\)$/, ''))
      : '';
  return { ...d, suggestedName: suggested };
}
