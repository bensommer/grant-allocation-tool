'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { getOrgId } from '@/lib/org';
import { safeReturnPath } from '@/lib/return-path';
import { recomputeAfterMutation } from '@/services/recompute-queue';

/** "Recalculate now" on the activity log (JPH-28 D4) — the only manual trigger left. */
export async function recomputeAction(): Promise<void> {
  const orgId = await getOrgId();
  const { result: r } = await recomputeAfterMutation(orgId, {
    trigger: 'manual',
    cause: 'Recalculate now',
  });
  revalidatePath('/', 'layout');
  if (!r || r.status === 'succeeded') redirect(r ? `/activity?done=${r.runId}` : '/activity');
  redirect(`/activity?failed=${r.runId}`);
}

/**
 * Post-redirect-get back to the page the button was pressed on. A failed run always lands on the
 * activity log so the failure is visible.
 */
export async function recomputeAndReturnAction(formData: FormData): Promise<void> {
  const orgId = await getOrgId();
  const { result: r } = await recomputeAfterMutation(orgId, {
    trigger: 'manual',
    cause: 'Recalculate now',
  });
  const safe = safeReturnPath(String(formData.get('returnTo') ?? ''));
  revalidatePath('/', 'layout');
  redirect(!r || r.status === 'succeeded' ? safe : `/activity?failed=${r.runId}`);
}
