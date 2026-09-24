import { notFound } from 'next/navigation';
import { Banner, ButtonLink, DangerZone, PageHeader } from '@/components/ui';
import { prisma } from '@/lib/db';
import { getOrgId } from '@/lib/org';
import { updateAllocationAction } from '../actions';
import { allocationEditorState, RuleForm, ruleOptions } from '../rule-form';

export const dynamic = 'force-dynamic';
export default async function EditAllocationPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { id } = await params;
  const query = await searchParams;
  const { saved, deactivated } = query;
  const orgId = await getOrgId();
  const rule = await prisma.allocationRule.findFirst({
    where: { id, orgId },
    include: { targets: true },
  });
  if (!rule) notFound();
  return (
    <>
      <PageHeader
        title={rule.name}
        secondaryActions={
          <ButtonLink href="/allocation" variant="secondary">
            All rules
          </ButtonLink>
        }
      />
      {deactivated ? (
        <Banner tone="warn">
          This rule appears in a compute run, so it was deactivated rather than deleted.
        </Banner>
      ) : null}
      <RuleForm
        action={updateAllocationAction.bind(null, id)}
        rule={rule}
        state={allocationEditorState(query)}
        saved={!!saved}
        options={await ruleOptions(orgId)}
        orgId={orgId}
        editorPath={`/allocation/${id}`}
        ui={query.ui}
      />
      <DangerZone>
        <ButtonLink href={`/allocation/${id}/delete`} variant="danger">
          Delete / deactivate…
        </ButtonLink>
      </DangerZone>
    </>
  );
}
