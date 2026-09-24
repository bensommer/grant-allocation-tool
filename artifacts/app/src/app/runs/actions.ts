'use server';

import { redirect } from 'next/navigation';
import { getOrgId } from '@/lib/org';
import { recompute } from '@/engine/recompute';

export async function recomputeAction(): Promise<void> {
  const orgId = await getOrgId();
  const r = await recompute(orgId);
  redirect(r.status === 'succeeded' ? `/runs?done=${r.runId}` : `/runs?failed=${r.runId}`);
}
