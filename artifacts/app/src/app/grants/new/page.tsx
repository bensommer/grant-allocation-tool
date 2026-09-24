import { PageHeader } from '@/components/page-header';
import { getOrgId } from '@/lib/org';
import { decodeFormState } from '@/lib/forms';
import { createGrantAction } from '../actions';
import { GrantForm } from '../grant-form';
import { grantFormOptions } from '../options';

export const dynamic = 'force-dynamic';

export default async function NewGrantPage({
  searchParams,
}: {
  searchParams: Promise<{ f?: string }>;
}) {
  const { f } = await searchParams;
  const orgId = await getOrgId();
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
