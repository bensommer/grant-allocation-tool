'use server';

import { redirect } from 'next/navigation';
import { redirectWithErrors, str, strOrNull } from '@/lib/forms';
import { getOrgId } from '@/lib/org';
import { saveDefaultDestination, savePacingSettings } from '@/services/settings';

export async function saveSettingsAction(formData: FormData) {
  const under = str(formData, 'underPercent');
  const over = str(formData, 'overPercent');
  const errors: Record<string, string> = {};
  for (const [name, value] of [
    ['underPercent', under],
    ['overPercent', over],
  ] as const) {
    if (!/^\d{1,3}(\.\d)?$/.test(value) || Number(value) > 100)
      errors[name] = 'Enter a percentage from 0 to 100 (one decimal maximum).';
  }
  if (Object.keys(errors).length) redirectWithErrors('/settings', errors, formData);
  await savePacingSettings(await getOrgId(), Number(under), Number(over));
  redirect('/settings?saved=1');
}

/** Default destination (class and/or project/customer) for correcting entries (JPH-22). */
export async function saveDestinationAction(formData: FormData) {
  const classId = strOrNull(formData, 'defaultDestinationClassId');
  const partyId = strOrNull(formData, 'defaultDestinationPartyId');
  try {
    await saveDefaultDestination(await getOrgId(), { classId, partyId });
  } catch (e) {
    redirectWithErrors(
      '/settings',
      { destination: e instanceof Error ? e.message : 'Could not save the destination' },
      formData,
    );
  }
  redirect('/settings?saved=1#destination');
}
