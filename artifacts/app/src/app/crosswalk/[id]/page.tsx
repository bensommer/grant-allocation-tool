import { notFound } from 'next/navigation';
import { Banner, ButtonLink, DangerZone, PageHeader } from '@/components/ui';
import { crosswalkBuilderOptions } from '@/components/rule-builder/options';
import { RuleBuilderPage } from '@/components/rule-builder/server';
import { prisma } from '@/lib/db';
import { decodeFormState } from '@/lib/forms';
import { getOrgId } from '@/lib/org';
import { updateCrosswalkAction } from '../actions';

export const dynamic = 'force-dynamic';

export default async function CrosswalkRulePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ f?: string; saved?: string; preview?: string; deactivated?: string }>;
}) {
  const { id } = await params;
  const { f, saved, preview, deactivated } = await searchParams;
  const orgId = await getOrgId();
  const rule = await prisma.crosswalkRule.findFirst({ where: { id, orgId } });
  if (!rule) notFound();
  const options = await crosswalkBuilderOptions(orgId);
  return (
    <>
      <PageHeader
        title={rule.name ?? 'Crosswalk rule'}
        secondaryActions={
          <ButtonLink href="/crosswalk" variant="secondary">
            All rules
          </ButtonLink>
        }
      />
      {deactivated ? (
        <Banner tone="warn">
          This rule is used by a compute run, so it was deactivated rather than deleted.
        </Banner>
      ) : null}
      <RuleBuilderPage
        kind="crosswalk"
        orgId={orgId}
        rule={rule}
        state={decodeFormState(f)}
        saved={!!saved}
        showPreview={!!preview}
        prefill={null}
        options={options}
        action={updateCrosswalkAction.bind(null, id)}
      />
      <DangerZone>
        <ButtonLink href={`/crosswalk/${id}/delete`} variant="danger">
          Delete / deactivate…
        </ButtonLink>
      </DangerZone>
    </>
  );
}
