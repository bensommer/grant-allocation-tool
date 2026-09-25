import { notFound } from 'next/navigation';
import { PageHeader } from '@/components/page-header';
import { DangerZone } from '@/components/ui';
import { prisma } from '@/lib/db';
import { getOrgId } from '@/lib/org';
import { decodeFormState } from '@/lib/forms';
import { deactivateGrantRuleAction, updateGrantRuleAction } from '../../../actions';
import { GrantTabs } from '../../tabs';
import { GrantRuleForm } from '../rule-form';
import { grantRuleOptions, runPreview } from '../shared';

export const dynamic = 'force-dynamic';

export default async function GrantRulePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string; ruleId: string }>;
  searchParams: Promise<{ f?: string; saved?: string; preview?: string }>;
}) {
  const { id, ruleId } = await params;
  const { f, saved, preview: showPreview } = await searchParams;
  const orgId = await getOrgId();
  const [grant, rule] = await Promise.all([
    prisma.grant.findFirst({ where: { id, orgId } }),
    prisma.crosswalkRule.findFirst({ where: { id: ruleId, orgId, grantId: id } }),
  ]);
  if (!grant || !rule) notFound();
  const state = decodeFormState(f);
  const [options, preview] = await Promise.all([
    grantRuleOptions(orgId, id),
    showPreview && state ? runPreview(orgId, id, state, ruleId) : Promise.resolve(undefined),
  ]);
  return (
    <>
      <PageHeader title={`${grant.name} · ${rule.name ?? 'rule'}`} />
      <GrantTabs id={id} active="rules" />
      <GrantRuleForm
        action={updateGrantRuleAction.bind(null, id, ruleId)}
        state={state}
        saved={!!saved}
        rule={rule}
        options={options}
        preview={preview}
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
