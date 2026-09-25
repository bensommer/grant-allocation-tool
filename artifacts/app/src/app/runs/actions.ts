'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { getOrgId } from '@/lib/org';
import { safeReturnPath } from '@/lib/return-path';
import { recompute } from '@/engine/recompute';

export async function recomputeAction(): Promise<void> {
  const orgId = await getOrgId();
  const r = await recompute(orgId);
  revalidatePath('/', 'layout');
  redirect(r.status === 'succeeded' ? `/runs?done=${r.runId}` : `/runs?failed=${r.runId}`);
}

/**
 * Header "Recompute" button: post-redirect-get back to the page it was pressed on. A failed run
 * always lands on /runs so the failure is visible.
 */
export async function recomputeAndReturnAction(formData: FormData): Promise<void> {
  const orgId = await getOrgId();
  const r = await recompute(orgId);
  const safe = safeReturnPath(String(formData.get('returnTo') ?? ''));
  // The status indicator lives in the root layout; make sure the client router re-renders it
  // even when the redirect lands on the URL the button was pressed on.
  revalidatePath('/', 'layout');
  redirect(r.status === 'succeeded' ? safe : `/runs?failed=${r.runId}`);
}
