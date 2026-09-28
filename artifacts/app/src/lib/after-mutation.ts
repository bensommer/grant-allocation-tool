import { revalidatePath } from 'next/cache';
import { recomputeAfterMutation, type RecomputeTrigger } from '@/services/recompute-queue';

/**
 * JPH-28 D1: every server action whose write makes the current calculation out of date calls
 * this before it redirects. The calculation runs (or queues behind the one in progress) on the
 * server; the page the action lands on already shows "Updated just now". A failed calculation
 * is recorded and the previous one stays current — the header chip says so; the action still
 * redirects normally.
 */
export async function recalculateAfter(
  orgId: string,
  cause: string,
  trigger: RecomputeTrigger = 'auto',
): Promise<void> {
  await recomputeAfterMutation(orgId, { trigger, cause });
  // The header chip lives in the root layout; make the client router re-render it even when the
  // redirect lands on the URL the form was posted from.
  revalidatePath('/', 'layout');
}
