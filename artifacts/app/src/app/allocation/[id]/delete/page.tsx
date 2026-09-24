import { notFound } from 'next/navigation';
import { ConfirmPage } from '@/components/ui';
import { prisma } from '@/lib/db';
import { getOrgId } from '@/lib/org';
import { deleteAllocationAction } from '../../actions';

export default async function DeleteAllocationPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const orgId = await getOrgId();
  const rule = await prisma.allocationRule.findFirst({
    where: { orgId, id },
    select: { name: true },
  });
  if (!rule) notFound();
  return (
    <ConfirmPage
      entityName={rule.name}
      description="This rule will be deleted if unused, or deactivated if referenced by a compute run."
      cancelHref={`/allocation/${id}`}
      action={deleteAllocationAction.bind(null, id)}
      submitLabel="Delete / deactivate rule"
    />
  );
}
