import { ButtonLink, PageHeader } from '@/components/ui';
import { getOrgId } from '@/lib/org';
import { createAllocationAction } from '../actions';
import { allocationEditorState, RuleForm, ruleOptions } from '../rule-form';

export const dynamic = 'force-dynamic';
export default async function NewAllocationPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const query = await searchParams;
  const orgId = await getOrgId();
  return (
    <>
      <PageHeader
        title="New shared cost split"
        secondaryActions={
          <ButtonLink href="/allocation" variant="secondary">
            All rules
          </ButtonLink>
        }
      />
      <RuleForm
        action={createAllocationAction}
        state={allocationEditorState(query)}
        rule={null}
        options={await ruleOptions(orgId)}
        orgId={orgId}
        editorPath="/allocation/new"
        ui={query.ui}
      />
    </>
  );
}
