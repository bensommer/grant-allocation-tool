import { notFound } from 'next/navigation';
import { ConfirmPage } from '@/components/ui';
import { prisma } from '@/lib/db';
import { getOrgId } from '@/lib/org';
import { deleteProgramAction } from '../../actions';

export default async function DeleteProgramPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const orgId = await getOrgId();
  const program = await prisma.program.findFirst({ where: { id, orgId }, select: { name: true } });
  if (!program) notFound();
  return (
    <ConfirmPage
      entityName={program.name}
      description="This will delete the program if unused, or deactivate it if referenced by grants, rules or compute runs."
      cancelHref={`/programs/${id}`}
      action={deleteProgramAction.bind(null, id)}
      submitLabel="Delete / deactivate program"
    />
  );
}
