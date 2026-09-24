'use server';

import { redirect } from 'next/navigation';
import { redirectWithErrors, str } from '@/lib/forms';
import { getOrgId } from '@/lib/org';
import { deletePeriodLock, lockPeriod } from '@/services/periods';

export async function createPeriodAction(formData: FormData) {
  const name = str(formData, 'name');
  const from = str(formData, 'from');
  const to = str(formData, 'to');
  if (!name || !/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to) || from > to)
    redirectWithErrors(
      '/settings/periods',
      { name: 'Enter a name and valid dates (from must be before to).' },
      formData,
    );
  try {
    await lockPeriod(
      await getOrgId(),
      name,
      new Date(`${from}T00:00:00Z`),
      new Date(`${to}T00:00:00Z`),
      str(formData, 'note'),
    );
  } catch (error) {
    redirectWithErrors('/settings/periods', { name: (error as Error).message }, formData);
  }
  redirect('/settings/periods?saved=1');
}

export async function deletePeriodAction(formData: FormData) {
  await deletePeriodLock(await getOrgId(), str(formData, 'id'));
  redirect('/settings/periods?saved=1');
}
