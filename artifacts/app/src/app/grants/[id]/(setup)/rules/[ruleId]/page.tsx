import { notFound } from 'next/navigation';
import { PageHeader } from '@/components/page-header';
import { DangerZone } from '@/components/ui';
import { grantBuilderOptions } from '@/components/rule-builder/options';
import { RuleBuilderPage } from '@/components/rule-builder/server';
import { prisma } from '@/lib/db';
import { decodeFormState } from '@/lib/forms';
import { getOrgId } from '@/lib/org';
import { deactivateGrantRuleAction, updateGrantRuleAction } from '@/app/grants/actions';
import { EditGrantButton } from '@/app/grants/[id]/edit-grant-button';
import { GrantTabs } from '@/app/grants/[id]/tabs';

export const dynamic = 'force-dynamic';

export default async function GrantRulePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string; ruleId: string }>;
  searchParams: Promise<{ f?: string; saved?: string; preview?: string }>;
}) {
  const { id, ruleId } = await params;
  const { f, saved, preview } = await searchParams;
  const orgId = await getOrgId();
  const [grant, rule] = await Promise.all([
    prisma.grant.findFirst({ where: { id, orgId } }),
    prisma.crosswalkRule.findFirst({ where: { id: ruleId, orgId, grantId: id } }),
  ]);
  if (!grant || !rule) notFound();
  const options = await grantBuilderOptions(orgId, id);
  return (
    <>
      <PageHeader
        title={`${grant.name} · ${rule.name ?? 'rule'}`}
        secondaryActions={<EditGrantButton id={id} />}
      />
      <GrantTabs id={id} active="rules" />
      <RuleBuilderPage
        kind="grant"
        orgId={orgId}
        grant={{ id, name: grant.name }}
        rule={rule}
        state={decodeFormState(f)}
        saved={!!saved}
        showPreview={!!preview}
        prefill={null}
        options={options}
        action={updateGrantRuleAction.bind(null, id, ruleId)}
      />
      {rule.active ? (
        <DangerZone title="Deactivate">
          <form action={deactivateGrantRuleAction.bind(null, id, ruleId)}>
            <p className="muted mb-2 text-sm">
              Rules are never deleted once a run references them; deactivating stops them from
              matching on the next recompute.
            </p>
            <button type="submit" className="btn btn-danger">
              Deactivate rule
            </button>
          </form>
        </DangerZone>
      ) : null}
    </>
  );
}
