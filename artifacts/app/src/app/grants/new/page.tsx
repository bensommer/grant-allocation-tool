import { redirect } from 'next/navigation';
import { PageHeader } from '@/components/page-header';
import { getOrgId } from '@/lib/org';
import { decodeFormState } from '@/lib/forms';
import { loadDraft } from '@/services/grant-draft';
import { createGrantAction } from '../actions';
import { GrantForm } from '../grant-form';
import { grantFormOptions } from '../options';

export const dynamic = 'force-dynamic';

/**
 * `/grants/new` starts (or resumes) the five-step setup wizard (JPH-29 E4). `?mode=form`
 * keeps the single-page form for people who already know every field.
 */
export default async function NewGrantPage({
  searchParams,
}: {
  searchParams: Promise<{ f?: string; mode?: string }>;
}) {
  const { f, mode } = await searchParams;
  const orgId = await getOrgId();
  if (mode !== 'form') {
    const draft = await loadDraft(orgId);
    redirect(`/grants/new/${draft?.step ?? 1}`);
  }
  const opts = await grantFormOptions(orgId);
  return (
    <>
      <PageHeader title="New grant" />
      <GrantForm
        action={createGrantAction}
        state={decodeFormState(f)}
        grant={null}
        {...opts}
        submitLabel="Create grant"
      />
    </>
  );
}
