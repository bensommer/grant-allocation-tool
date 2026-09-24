import { PageHeader } from '@/components/page-header';
import { decodeFormState, pick } from '@/lib/forms';
import { getOrgId } from '@/lib/org';
import { dateRange } from '../range';
import { previewRule } from '@/engine/preview';
import { parseMatchers } from '@/domain/matchers';
import { createCrosswalkAction } from '../actions';
import { crosswalkOptions } from '../options';
import { RuleForm } from '../rule-form';
import { previewInputMatchers } from '../preview-values';

export const dynamic = 'force-dynamic';

export default async function NewCrosswalkPage({
  searchParams,
}: {
  searchParams: Promise<{ f?: string; preview?: string }>;
}) {
  const { f, preview: showPreview } = await searchParams;
  const state = decodeFormState(f);
  const orgId = await getOrgId();
  const options = await crosswalkOptions(orgId);
  const range = dateRange(
    state ? pick(state, 'previewFrom', '') : undefined,
    state ? pick(state, 'previewTo', '') : undefined,
  );
  const preview =
    showPreview && state && range.first && range.last
      ? await previewRule(
          orgId,
          {
            kind: 'crosswalk',
            matchers: parseMatchers(previewInputMatchers(state)),
            grantBudgetLineId: pick(state, 'grantBudgetLineId', '') || null,
            priority: Number(pick(state, 'priority', '100')) || 0,
          },
          { from: range.first, to: range.last },
        )
      : undefined;
  return (
    <>
      <PageHeader title="New crosswalk rule" />
      <RuleForm
        action={createCrosswalkAction}
        state={state}
        rule={null}
        options={options}
        preview={preview}
      />
    </>
  );
}
