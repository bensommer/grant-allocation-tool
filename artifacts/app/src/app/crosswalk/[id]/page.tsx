import Link from 'next/link';
import { notFound } from 'next/navigation';
import { PageHeader } from '@/components/page-header';
import { prisma } from '@/lib/db';
import { decodeFormState, pick } from '@/lib/forms';
import { getOrgId } from '@/lib/org';
import { parseMatchers } from '@/domain/matchers';
import { previewRule } from '@/engine/preview';
import { deleteCrosswalkAction, updateCrosswalkAction } from '../actions';
import { crosswalkOptions } from '../options';
import { previewInputMatchers } from '../preview-values';
import { dateRange } from '../range';
import { RuleForm } from '../rule-form';

export const dynamic = 'force-dynamic';

export default async function CrosswalkRulePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ f?: string; saved?: string; preview?: string; deactivated?: string }>;
}) {
  const { id } = await params;
  const { f, saved, preview: showPreview, deactivated } = await searchParams;
  const orgId = await getOrgId();
  const rule = await prisma.crosswalkRule.findFirst({ where: { id, orgId } });
  if (!rule) notFound();
  const state = decodeFormState(f);
  const range = dateRange(
    state ? pick(state, 'previewFrom', '') : undefined,
    state ? pick(state, 'previewTo', '') : undefined,
  );
  const [options, preview] = await Promise.all([
    crosswalkOptions(orgId),
    showPreview && state && range.first && range.last
      ? previewRule(
          orgId,
          {
            kind: 'crosswalk',
            matchers: parseMatchers(previewInputMatchers(state)),
            grantBudgetLineId: pick(state, 'grantBudgetLineId', '') || null,
            priority: Number(pick(state, 'priority', '100')) || 0,
            ruleId: id,
          },
          { from: range.first, to: range.last },
        )
      : Promise.resolve(undefined),
  ]);
  return (
    <>
      <PageHeader
        title={rule.name ?? 'Crosswalk rule'}
        actions={
          <>
            <Link href="/crosswalk" className="btn btn-secondary btn-sm">
              All rules
            </Link>
            <form action={deleteCrosswalkAction.bind(null, id)}>
              <button className="btn btn-danger btn-sm">Delete / deactivate</button>
            </form>
          </>
        }
      />
      {deactivated ? (
        <div className="banner banner-warn">
          This rule is used by a compute run, so it was deactivated rather than deleted.
        </div>
      ) : null}
      <RuleForm
        action={updateCrosswalkAction.bind(null, id)}
        state={state}
        saved={!!saved}
        rule={rule}
        options={options}
        preview={preview}
      />
    </>
  );
}
