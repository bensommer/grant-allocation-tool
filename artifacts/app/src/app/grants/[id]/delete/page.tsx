import { notFound } from 'next/navigation';
import { ConfirmPage } from '@/components/ui';
import { prisma } from '@/lib/db';
import { getOrgId } from '@/lib/org';
import { deleteGrantAction } from '../../actions';

export default async function DeleteGrantPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const orgId = await getOrgId();
  const grant = await prisma.grant.findFirst({ where: { id, orgId }, select: { name: true } });
  if (!grant) notFound();
  return (
    <ConfirmPage
      entityName={grant.name}
      description="This will delete the grant if unused, or archive it if it appears in a compute run. Existing history is preserved."
      cancelHref={`/grants/${id}`}
      action={deleteGrantAction.bind(null, id)}
      submitLabel="Delete / archive grant"
    />
  );
}
