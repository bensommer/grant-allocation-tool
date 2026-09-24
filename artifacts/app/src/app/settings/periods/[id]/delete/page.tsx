import { notFound } from 'next/navigation';
import { ConfirmPage, Period } from '@/components/ui';
import { prisma } from '@/lib/db';
import { getOrgId } from '@/lib/org';
import { deletePeriodAction } from '../../actions';

export const dynamic = 'force-dynamic';

export default async function DeletePeriod({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const lock = await prisma.periodLock.findFirst({ where: { id, orgId: await getOrgId() } });
  if (!lock) notFound();
  async function remove() {
    'use server';
    const data = new FormData();
    data.set('id', id);
    await deletePeriodAction(data);
  }
  return (
    <ConfirmPage
      entityName={lock.name}
      description="Unlocking this reporting period removes its snapshot and drift tracking."
      cancelHref="/settings/periods"
      action={remove}
      submitLabel="Delete period lock"
    >
      <Period from={lock.periodFrom} to={lock.periodTo} />
    </ConfirmPage>
  );
}
