import Link from 'next/link';
import { notFound } from 'next/navigation';
import { PageHeader } from '@/components/page-header';
import { prisma } from '@/lib/db';
import { getOrgId } from '@/lib/org';
import { decodeFormState } from '@/lib/forms';
import { deleteAllocationAction, updateAllocationAction } from '../actions';
import { RuleForm, ruleOptions } from '../rule-form';

export const dynamic = 'force-dynamic';
export default async function EditAllocationPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ f?: string; saved?: string; deactivated?: string; preview?: string }>;
}) {
  const { id } = await params;
  const { f, saved, deactivated } = await searchParams;
  const orgId = await getOrgId();
  const rule = await prisma.allocationRule.findFirst({
    where: { id, orgId },
    include: { targets: true },
  });
  if (!rule) notFound();
  return (
    <>
      <PageHeader
        title={rule.name}
        actions={
          <>
            <Link href="/allocation" className="btn btn-secondary btn-sm">
              All rules
            </Link>
            <form action={deleteAllocationAction.bind(null, id)}>
              <button className="btn btn-danger btn-sm">Delete / deactivate</button>
            </form>
          </>
        }
      />
      {deactivated ? (
        <div className="banner banner-warn">
          This rule appears in a compute run, so it was deactivated rather than deleted.
        </div>
      ) : null}
      <RuleForm
        action={updateAllocationAction.bind(null, id)}
        rule={rule}
        state={decodeFormState(f)}
        saved={!!saved}
        options={await ruleOptions(orgId)}
        orgId={orgId}
      />
    </>
  );
}
