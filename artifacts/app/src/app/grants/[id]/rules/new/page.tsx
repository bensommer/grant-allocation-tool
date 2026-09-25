import { notFound } from 'next/navigation';
import { PageHeader } from '@/components/page-header';
import { prisma } from '@/lib/db';
import { getOrgId } from '@/lib/org';
import { decodeFormState } from '@/lib/forms';
import { createGrantRuleAction } from '../../../actions';
import { GrantTabs } from '../../tabs';
import { GrantRuleForm } from '../rule-form';
import { grantRuleOptions, runPreview } from '../shared';

export const dynamic = 'force-dynamic';

export default async function NewGrantRulePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ f?: string; preview?: string }>;
}) {
  const { id } = await params;
  const { f, preview: showPreview } = await searchParams;
  const orgId = await getOrgId();
  const grant = await prisma.grant.findFirst({ where: { id, orgId } });
  if (!grant) notFound();
  const state = decodeFormState(f);
  const [options, preview] = await Promise.all([
    grantRuleOptions(orgId, id),
    showPreview && state ? runPreview(orgId, id, state) : Promise.resolve(undefined),
  ]);
  return (
    <>
      <PageHeader title={`${grant.name} · new rule`} />
      <GrantTabs id={id} active="rules" />
      <GrantRuleForm
        action={createGrantRuleAction.bind(null, id)}
        state={state}
        rule={null}
        options={options}
        preview={preview}
      />
    </>
  );
}
