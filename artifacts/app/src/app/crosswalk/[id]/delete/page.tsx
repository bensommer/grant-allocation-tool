import { notFound } from 'next/navigation';
import { ConfirmPage } from '@/components/ui';
import { prisma } from '@/lib/db';
import { getOrgId } from '@/lib/org';
import { deleteCrosswalkAction } from '../../actions';

export default async function DeleteCrosswalkPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const orgId = await getOrgId();
  const rule = await prisma.crosswalkRule.findFirst({
    where: { orgId, id },
    select: { name: true },
  });
  if (!rule) notFound();
  return (
    <ConfirmPage
      entityName={rule.name ?? 'Crosswalk rule'}
      description="This rule will be deleted if unused, or deactivated if referenced by a compute run."
      cancelHref={`/crosswalk/${id}`}
      action={deleteCrosswalkAction.bind(null, id)}
      submitLabel="Delete / deactivate rule"
    />
  );
}
