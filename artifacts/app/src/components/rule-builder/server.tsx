/**
 * Server side of the rule builder: turns a stored rule, a bounced form state or a `/new` link's
 * query string into the builder's values, runs the server-rendered preview, and mounts the
 * component. The four rule routes are thin wrappers around `RuleBuilderPage`.
 */
import { parseMatchers } from '@/domain/matchers';
import type { FormState } from '@/lib/forms';
import { currentPeriod } from '@/lib/period';
import {
  emptyRuleValues,
  formStateReader,
  readRuleValues,
  type RuleFormValues,
  type RuleKind,
} from '@/lib/rule-form';
import { previewRuleForm } from '@/services/rule-preview';
import { RuleBuilder } from './rule-builder';
import type { BuilderOptions, RulePreviewData } from './types';

export interface StoredRule {
  id: string;
  name: string | null;
  dimension: string;
  grantBudgetLineId: string | null;
  targetActivityId: string | null;
  targetCategoryKey: string | null;
  priority: number;
  active: boolean;
  matchers: unknown;
}

export function valuesFromRule(kind: RuleKind, rule: StoredRule): RuleFormValues {
  const m = parseMatchers(rule.matchers);
  const dim =
    rule.dimension === 'activity' || rule.dimension === 'category' ? rule.dimension : 'line';
  return {
    ...emptyRuleValues(kind, rule.priority),
    name: rule.name ?? '',
    dimension: dim,
    grantBudgetLineId: rule.grantBudgetLineId ?? '',
    targetActivityId: rule.targetActivityId ?? '',
    targetCategoryKey: rule.targetCategoryKey ?? '',
    active: rule.active,
    programIds: kind === 'crosswalk' ? (m.programIds ?? []) : [],
    accountIds: m.accountIds ?? [],
    classIds: m.classIds ?? [],
    locationIds: m.locationIds ?? [],
    partyIds: m.partyIds ?? [],
    txnTypes: m.txnTypes ?? [],
    accountFrom: m.accountRange?.from ?? '',
    accountTo: m.accountRange?.to ?? '',
    descriptionContains: m.descriptionContains ?? '',
    descriptionContainsAny: (m.descriptionContainsAny ?? []).join(', '),
    amountSign: m.amountSign ?? '',
    dateFrom: m.dateFrom ?? '',
    dateTo: m.dateTo ?? '',
  };
}

/** Bounced form state wins over the stored rule, which wins over the link's prefill. */
export function initialValues(
  kind: RuleKind,
  state: FormState | null,
  rule: StoredRule | null,
  prefill: RuleFormValues | null,
): RuleFormValues {
  if (state) return readRuleValues(formStateReader(state), kind);
  if (rule) return valuesFromRule(kind, rule);
  return prefill ?? emptyRuleValues(kind);
}

export async function RuleBuilderPage({
  kind,
  orgId,
  grant,
  rule,
  state,
  saved,
  showPreview,
  prefill,
  options,
  action,
  returnTo,
}: {
  kind: RuleKind;
  orgId: string;
  grant?: { id: string; name: string };
  rule: StoredRule | null;
  state: FormState | null;
  saved?: boolean;
  /** `?preview=1` — the no-JS Preview button bounced the form back. */
  showPreview: boolean;
  prefill: RuleFormValues | null;
  options: BuilderOptions;
  action: (formData: FormData) => Promise<void>;
  /** Where Save returns to instead of the rule page (already validated by the caller). */
  returnTo?: string;
}) {
  const values = initialValues(kind, state, rule, prefill);
  // Server-render the preview whenever there is something to preview: the Preview button, an
  // existing rule, or a prefilled link. A blank new form waits for the island (or the button).
  const wantPreview = showPreview || rule !== null || prefill !== null;
  let preview: RulePreviewData | null = null;
  if (wantPreview) {
    const { range } = await currentPeriod(orgId);
    preview = await previewRuleForm(orgId, {
      kind,
      values,
      range,
      ...(grant ? { grantId: grant.id } : {}),
      ...(rule ? { ruleId: rule.id } : {}),
    });
  }
  const q = new URLSearchParams({ kind });
  if (grant) q.set('grantId', grant.id);
  if (rule) q.set('ruleId', rule.id);
  return (
    <RuleBuilder
      kind={kind}
      grantName={grant?.name}
      action={action}
      values={values}
      state={state}
      saved={saved}
      options={options}
      preview={preview}
      previewUrl={`/api/rules/preview?${q}`}
      isNew={rule === null}
      returnTo={returnTo}
    />
  );
}
