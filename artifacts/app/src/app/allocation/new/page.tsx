import Link from 'next/link';
import { PageHeader } from '@/components/page-header';
import { decodeFormState } from '@/lib/forms';
import { getOrgId } from '@/lib/org';
import { createAllocationAction } from '../actions';
import { RuleForm, ruleOptions } from '../rule-form';

export const dynamic = 'force-dynamic';
export default async function NewAllocationPage({
  searchParams,
}: {
  searchParams: Promise<{ f?: string; preview?: string }>;
}) {
  const { f } = await searchParams;
  const orgId = await getOrgId();
  return (
    <>
      <PageHeader
        title="New allocation rule"
        actions={
          <Link href="/allocation" className="btn btn-secondary btn-sm">
            All rules
          </Link>
        }
      />
      <RuleForm
        action={createAllocationAction}
        state={decodeFormState(f)}
        rule={null}
        options={await ruleOptions(orgId)}
        orgId={orgId}
      />
    </>
  );
}
