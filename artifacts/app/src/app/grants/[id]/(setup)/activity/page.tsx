import Link from 'next/link';
import { notFound } from 'next/navigation';
import { PageHeader, Period } from '@/components/ui';
import { getOrgId } from '@/lib/org';
import { budgetTree } from '@/services/grant-budget';
import { grantHeader } from '@/services/grant-workspace';
import { EditGrantButton } from '@/app/grants/[id]/edit-grant-button';
import { GrantTabs } from '../../tabs';
import { ActivityGridCard } from './activity-grid';

export const dynamic = 'force-dynamic';

/**
 * Setup › Activities: the activity × category grid on its own page (the Status tab embeds the
 * same card when the grant has activities); activities themselves are edited on the budget page.
 */
export default async function ActivityGridPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const orgId = await getOrgId();
  const grant = await grantHeader(orgId, id);
  if (!grant) notFound();
  const tree = await budgetTree(orgId, id);
  return (
    <>
      <PageHeader
        title={grant.name}
        subtitle={
          <>
            {grant.funder} · <Period from={grant.startDate} to={grant.endDate} />
          </>
        }
        secondaryActions={<EditGrantButton id={id} />}
      />
      <GrantTabs id={id} active="activity" />
      <p className="muted mb-3 text-sm">
        Activities and their budget per category are set on the{' '}
        <Link href={`/grants/${id}/budget#activities`}>budget page</Link>.
      </p>
      <ActivityGridCard tree={tree} />
    </>
  );
}
