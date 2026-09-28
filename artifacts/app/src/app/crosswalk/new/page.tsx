import { PageHeader } from '@/components/ui';
import { crosswalkBuilderOptions } from '@/components/rule-builder/options';
import { prefillValues, type PrefillParams } from '@/components/rule-builder/prefill';
import { RuleBuilderPage } from '@/components/rule-builder/server';
import { decodeFormState } from '@/lib/forms';
import { getOrgId } from '@/lib/org';
import { createCrosswalkAction } from '../actions';

export const dynamic = 'force-dynamic';

export default async function NewCrosswalkPage({
  searchParams,
}: {
  searchParams: Promise<{ f?: string; preview?: string } & PrefillParams>;
}) {
  const { f, preview, ...prefillParams } = await searchParams;
  const orgId = await getOrgId();
  const options = await crosswalkBuilderOptions(orgId);
  return (
    <>
      <PageHeader title="New crosswalk rule" />
      <RuleBuilderPage
        kind="crosswalk"
        orgId={orgId}
        rule={null}
        state={decodeFormState(f)}
        showPreview={!!preview}
        prefill={prefillValues('crosswalk', options, prefillParams)}
        options={options}
        action={createCrosswalkAction}
      />
    </>
  );
}
