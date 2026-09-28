import { notFound } from 'next/navigation';
import { ButtonLink, DangerZone, PageHeader } from '@/components/ui';
import { prisma } from '@/lib/db';
import { getOrgId } from '@/lib/org';
import { decodeFormState } from '@/lib/forms';
import { updateGrantAction } from '@/app/grants/actions';
import { GrantForm } from '@/app/grants/grant-form';
import { grantFormOptions } from '@/app/grants/options';
import { GrantTabs } from '@/app/grants/[id]/tabs';

export const dynamic = 'force-dynamic';

export default async function EditGrantPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ f?: string; saved?: string }>;
}) {
  const { id } = await params;
  const { f, saved } = await searchParams;
  const orgId = await getOrgId();
  const grant = await prisma.grant.findFirst({ where: { id, orgId }, include: { programs: true } });
  if (!grant) notFound();
  const opts = await grantFormOptions(orgId);
  return (
    <>
      <PageHeader title={`Edit ${grant.name}`} subtitle={grant.funder} />
      <GrantTabs id={id} active="edit" />
      <GrantForm
        action={updateGrantAction.bind(null, id)}
        state={decodeFormState(f)}
        saved={!!saved}
        grant={grant}
        {...opts}
        submitLabel="Save changes"
      />
      <DangerZone>
        <p className="mb-3">
          Remove this grant or archive it if it is referenced by a compute run.
        </p>
        <ButtonLink variant="danger" size="sm" href={`/grants/${id}/delete`}>
          Delete / archive grant…
        </ButtonLink>
      </DangerZone>
    </>
  );
}
