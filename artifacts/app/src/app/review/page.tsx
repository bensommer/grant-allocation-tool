import Link from 'next/link';
import { PageHeader } from '@/components/page-header';
import { Money } from '@/components/ui';
import { TERMS } from '@/copy/terms';
import { getOrgId } from '@/lib/org';
import { decodeFormState } from '@/lib/forms';
import { orgReviewQueue } from '@/services/review-queue';
import { getDefaultDestination, isDestinationSet } from '@/services/settings';
import { QueueTable } from './queue-table';
import {
  QueueBanners,
  QueueFilterBar,
  QueueHeadline,
  hasFilters,
  queueFilters,
  type QueueSearchParams,
} from './queue-chrome';

export const dynamic = 'force-dynamic';

/** Every grant's queue in one table (JPH-27 C2): the QuickBooks "For Review" tab across grants. */
export default async function OrgReviewPage({
  searchParams,
}: {
  searchParams: Promise<QueueSearchParams>;
}) {
  const sp = await searchParams;
  const orgId = await getOrgId();
  const filters = queueFilters(sp);
  const [org, destination] = await Promise.all([
    orgReviewQueue(orgId, filters),
    getDefaultDestination(orgId),
  ]);
  const state = decodeFormState(sp.f);
  const filtered = hasFilters(filters);
  return (
    <>
      <PageHeader
        title="Review"
        subtitle={`${TERMS.transactions} the rules could not settle, across every grant you track by ${TERMS.transaction}. Each row suggests a target and says why; ${TERMS.decisionsSurvive}.`}
      />
      <QueueBanners sp={sp} state={state} entriesHref={null} editGrantHref={null} />
      <div className="card mb-4" data-testid="queue-card">
        <QueueHeadline count={org.count} totalCents={org.totalCents} />
        <ul className="mb-3 flex flex-wrap gap-x-4 gap-y-1 text-sm" data-testid="grant-summary">
          {org.grants.map((g) => (
            <li key={g.grantId} data-grant-id={g.grantId} data-count={g.count} data-cents={g.totalCents}>
              <Link href={`/grants/${g.grantId}/review`}>{g.grantName}</Link>{' '}
              <span className="muted">
                · {g.count === 0 ? 'nothing waiting' : <>{g.count} · <Money cents={g.totalCents} /></>}
              </span>
            </li>
          ))}
          {org.grants.length === 0 ? (
            <li className="muted">No grant is tracked by {TERMS.transaction} yet.</li>
          ) : null}
        </ul>
        <QueueFilterBar action="/review" filters={filters} grants={org.grants} />
        <QueueTable
          grants={org.grants}
          showGrant
          returnTo="/review"
          destinationSet={isDestinationSet(destination)}
          state={state}
          empty={
            filtered ? (
              <p className="muted text-sm" data-testid="queue-filtered-empty">
                No {TERMS.transactionsLower} match these filters —{' '}
                <Link href="/review">clear them</Link>.
              </p>
            ) : (
              <p className="muted text-sm" data-testid="queue-empty">
                Nothing waiting — every {TERMS.transaction} on every grant is assigned or excluded.
              </p>
            )
          }
        />
      </div>
    </>
  );
}
