import { notFound } from 'next/navigation';
import { PageHeader } from '@/components/page-header';
import { grantBuilderOptions } from '@/components/rule-builder/options';
import { prefillValues, type PrefillParams } from '@/components/rule-builder/prefill';
import { RuleBuilderPage } from '@/components/rule-builder/server';
import { prisma } from '@/lib/db';
import { decodeFormState } from '@/lib/forms';
import { getOrgId } from '@/lib/org';
import { safeReturnPath } from '@/lib/return-path';
import { createGrantRuleAction } from '@/app/grants/actions';
import { EditGrantButton } from '@/app/grants/[id]/edit-grant-button';
import { GrantTabs } from '@/app/grants/[id]/tabs';

export const dynamic = 'force-dynamic';

export default async function NewGrantRulePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ f?: string; preview?: string; returnTo?: string } & PrefillParams>;
}) {
  const { id } = await params;
  const { f, preview, returnTo: rawReturnTo, ...prefillParams } = await searchParams;
  // JPH-27 "Always do this": the queue links here and Save goes back to it.
  const returnTo = rawReturnTo ? safeReturnPath(rawReturnTo, '') || undefined : undefined;
  const orgId = await getOrgId();
  const grant = await prisma.grant.findFirst({ where: { id, orgId } });
  if (!grant) notFound();
  const options = await grantBuilderOptions(orgId, id);
  return (
    <>
      <PageHeader
        title={`${grant.name} · new rule`}
        secondaryActions={<EditGrantButton id={id} />}
      />
      <GrantTabs id={id} active="rules" />
      <RuleBuilderPage
        kind="grant"
        orgId={orgId}
        grant={{ id, name: grant.name }}
        rule={null}
        state={decodeFormState(f)}
        showPreview={!!preview}
        prefill={prefillValues('grant', options, prefillParams)}
        options={options}
        action={createGrantRuleAction.bind(null, id)}
        returnTo={returnTo}
      />
    </>
  );
}
