import Link from 'next/link';
import { notFound } from 'next/navigation';
import { PageHeader } from '@/components/page-header';
import { Banner, DateText, KeyFigure, Money, NumTd, StatusPill } from '@/components/ui';
import { TERMS } from '@/copy/terms';
import { getOrgId } from '@/lib/org';
import { decodeFormState } from '@/lib/forms';
import { grantReviewQueue } from '@/services/review-queue';
import type { ReviewLine } from '@/services/review';
import { getDefaultDestination, isDestinationSet } from '@/services/settings';
import { clearAtRiskAction, revertDecisionAction } from '../../actions';
import { EditGrantButton } from '@/app/grants/[id]/edit-grant-button';
import { GrantTabs } from '../tabs';
import { QueueTable } from '@/app/review/queue-table';
import {
  QueueBanners,
  QueueFilterBar,
  QueueHeadline,
  hasFilters,
  queueFilters,
  type QueueSearchParams,
} from '@/app/review/queue-chrome';
import { confirmPairAction } from '@/app/grants/review-actions';

export const dynamic = 'force-dynamic';

function LineCells({ l }: { l: ReviewLine }) {
  return (
    <>
      <td>
        <DateText date={l.txnDate} />
      </td>
      <td>
        {l.txnType}
        {l.docNumber ? ` ${l.docNumber}` : ''}
      </td>
      <td>{l.account}</td>
      <td>{l.party ?? '—'}</td>
      <td>{l.className ?? '—'}</td>
      <td className="max-w-md">{l.description ?? '—'}</td>
      <NumTd cents={l.amountCents} />
    </>
  );
}

const HEADERS = ['Date', 'Doc', 'Account', 'Name', 'Class', 'Description', 'Amount ($)'];

function plural(n: number, one: string, many: string) {
  return `${n} ${n === 1 ? one : many}`;
}

export default async function ReviewPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<QueueSearchParams & { show?: string }>;
}) {
  const { id } = await params;
  const sp = await searchParams;
  const orgId = await getOrgId();
  const filters = queueFilters(sp);
  const [grant, destination] = await Promise.all([
    grantReviewQueue(orgId, id, filters),
    getDefaultDestination(orgId),
  ]);
  if (!grant) notFound();
  const { queue } = grant;
  // A crosswalk-tracked grant has no transactions of its own; the tabs strip explains that.
  const crosswalk = grant.tracking?.mode === 'crosswalk';
  const state = decodeFormState(sp.f);
  const returnTo = `/grants/${id}/review`;
  const atRiskLines = [
    ...queue.assigned,
    ...queue.excluded,
    ...queue.groups.flatMap((g) => g.lines),
  ].filter((l) => l.atRisk);
  const showAll = sp.show === 'all';
  const pairLines = grant.pairCount;
  const filtered = hasFilters(filters);

  return (
    <>
      <PageHeader
        title={`${grant.grantName} · review`}
        subtitle={`One row per ${TERMS.transaction} the rules could not settle, with a suggested target and why. Accept it, change it, or mark the ${TERMS.transaction} not grant-funded; ${TERMS.decisionsSurvive}.`}
        secondaryActions={<EditGrantButton id={id} />}
      />
      <GrantTabs id={id} active="review" />
      <QueueBanners
        sp={sp}
        state={state}
        entriesHref={`/grants/${id}/entries`}
        editGrantHref={`/grants/${id}/edit`}
      />
      {queue.runId === null ? (
        <Banner tone="info">No compute run yet — run a recompute to populate the queue.</Banner>
      ) : null}
      {queue.stale ? (
        <Banner tone="warn">
          Configuration or decisions changed since the current run; recompute to refresh the
          figures.
        </Banner>
      ) : null}

      <div className="mb-4 grid gap-3 md:grid-cols-4" data-testid="review-counts">
        <KeyFigure
          label="Needs review"
          value={<Money cents={queue.totals.needsReviewCents} dollar />}
          hint={
            <span data-testid="needs-review-count">
              {plural(queue.counts.needsReview, TERMS.transaction, TERMS.transactionsLower)}
              {pairLines > 0 ? ` · ${plural(pairLines, 'pair', 'pairs')} to confirm` : ''}
            </span>
          }
          tone={queue.counts.needsReview > 0 ? 'warn' : 'ok'}
        />
        <KeyFigure
          label="Assigned"
          value={<Money cents={queue.totals.assignedCents} dollar />}
          hint={plural(queue.counts.assigned, TERMS.transaction, TERMS.transactionsLower)}
        />
        <KeyFigure
          label="Excluded"
          value={<Money cents={queue.totals.excludedCents} dollar />}
          hint={plural(queue.counts.excluded, TERMS.transaction, TERMS.transactionsLower)}
        />
        <KeyFigure
          label="Transactions on this grant"
          value={<Money cents={queue.totals.memberCents} dollar />}
          hint={`${queue.counts.atRisk} flagged at risk`}
          tone={queue.counts.atRisk > 0 ? 'warn' : 'muted'}
        />
      </div>

      {crosswalk ? null : (
        <div className="card mb-4" data-testid="queue-card">
          <QueueHeadline count={grant.count} totalCents={grant.totalCents} />
          <QueueFilterBar action={returnTo} filters={filters} grants={[grant]} />
          <QueueTable
            grants={[grant]}
            showGrant={false}
            returnTo={returnTo}
            destinationSet={isDestinationSet(destination)}
            state={state}
            empty={
              filtered ? (
                <p className="muted text-sm" data-testid="queue-filtered-empty">
                  No {TERMS.transactionsLower} match these filters —{' '}
                  <Link href={returnTo}>clear them</Link>.
                </p>
              ) : (
                <p className="muted text-sm" data-testid="queue-empty">
                  Nothing waiting — every {TERMS.transaction} is assigned or excluded.
                </p>
              )
            }
          />
        </div>
      )}

      {grant.settledPairs.length > 0 ? (
        <details className="card mb-4" data-testid="settled-pairs">
          <summary className="cursor-pointer">
            <strong>{plural(grant.settledPairs.length, 'reversal pair', 'reversal pairs')}</strong>{' '}
            <span className="muted text-sm">
              between {TERMS.transactionsLower} that are already settled — confirming records them
              as a pair instead
            </span>
          </summary>
          <div className="mt-3 max-w-full overflow-x-auto">
            <table>
              <thead>
                <tr>
                  {HEADERS.map((h) => (
                    <th key={h} className={h.endsWith('($)') ? 'num' : ''}>
                      {h}
                    </th>
                  ))}
                  <th>State</th>
                  <th className="relative">
                    <span className="sr-only">Confirm</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {grant.settledPairs.map((p) => (
                  <tr key={p.positive.id} data-pair={p.amountCents} data-settled-pair>
                    <LineCells l={p.positive} />
                    <td>
                      {p.positive.state}
                      {p.positive.budgetLineCode ? ` → ${p.positive.budgetLineCode}` : ''}
                      <span className="block">
                        {p.negative.state}
                        {p.negative.budgetLineCode ? ` → ${p.negative.budgetLineCode}` : ''}
                      </span>
                    </td>
                    <td>
                      <form action={confirmPairAction}>
                        <input type="hidden" name="grantId" value={id} />
                        <input type="hidden" name="positiveId" value={p.positive.id} />
                        <input type="hidden" name="negativeId" value={p.negative.id} />
                        <input type="hidden" name="returnTo" value={returnTo} />
                        <input
                          type="hidden"
                          name="note"
                          value={`Reversal pair ±${(p.amountCents / 100).toFixed(2)} confirmed`}
                        />
                        <button type="submit" className="btn btn-secondary btn-sm">
                          Confirm pair
                        </button>
                      </form>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      ) : null}

      {atRiskLines.length > 0 ? (
        <form action={clearAtRiskAction.bind(null, id)} className="card mb-4" data-testid="at-risk">
          <h2>Flagged at risk</h2>
          <div className="max-w-full overflow-x-auto">
            <table>
              <thead>
                <tr>
                  <th className="relative">
                    <span className="sr-only">Select</span>
                  </th>
                  {HEADERS.map((h) => (
                    <th key={h} className={h.endsWith('($)') ? 'num' : ''}>
                      {h}
                    </th>
                  ))}
                  <th>State</th>
                </tr>
              </thead>
              <tbody>
                {atRiskLines.map((l) => (
                  <tr key={l.id} data-at-risk-line={l.id}>
                    <td>
                      <input type="checkbox" name="lineIds" value={l.id} aria-label="Select" />
                    </td>
                    <LineCells l={l} />
                    <td>{l.state.replace('_', ' ')}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <button type="submit" className="btn btn-secondary btn-sm mt-2">
            Clear at-risk flag
          </button>
        </form>
      ) : null}

      <div className="card mb-4" data-testid="decision-trail">
        <h2>Decision trail</h2>
        {queue.decisions.length === 0 ? (
          <p className="muted text-sm">No decisions recorded.</p>
        ) : (
          <form action={revertDecisionAction.bind(null, id)}>
            <div className="max-w-full overflow-x-auto">
              <table>
                <thead>
                  <tr>
                    <th className="relative">
                      <span className="sr-only">Select</span>
                    </th>
                    <th>When</th>
                    <th>Kind</th>
                    <th>Target</th>
                    <th>Reason</th>
                    <th>Note</th>
                    <th>By</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {queue.decisions.map((d) => (
                    <tr key={d.id} data-decision-kind={d.kind} data-decision-group={d.groupId}>
                      <td>
                        {d.lineId && !d.supersededAt && d.kind !== 'at_risk' ? (
                          <input
                            type="checkbox"
                            name="lineIds"
                            value={d.lineId}
                            aria-label="Select"
                          />
                        ) : null}
                      </td>
                      <td>
                        <DateText date={d.createdAt} time />
                      </td>
                      <td>{d.kind.replace('_', ' ')}</td>
                      <td>{d.targetCode ?? '—'}</td>
                      <td>{d.reason ?? '—'}</td>
                      <td>{d.note}</td>
                      <td className="muted">{d.actor}</td>
                      <td>
                        {d.supersededAt ? (
                          <StatusPill tone="muted">superseded</StatusPill>
                        ) : (
                          <StatusPill tone="ok">active</StatusPill>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <button type="submit" className="btn btn-secondary btn-sm mt-2">
              Revert selected decisions (rules apply again)
            </button>
          </form>
        )}
      </div>

      <div className="card" data-testid="settled">
        <h2>
          Settled {TERMS.transactionsLower}{' '}
          <span className="muted text-sm font-normal">
            ({queue.counts.assigned} assigned · {queue.counts.excluded} excluded)
          </span>
        </h2>
        {showAll ? (
          <div className="max-w-full overflow-x-auto">
            <table>
              <thead>
                <tr>
                  {HEADERS.map((h) => (
                    <th key={h} className={h.endsWith('($)') ? 'num' : ''}>
                      {h}
                    </th>
                  ))}
                  <th>State</th>
                  <th>Via</th>
                </tr>
              </thead>
              <tbody>
                {[...queue.assigned, ...queue.excluded].map((l) => (
                  <tr key={l.id} data-state={l.state} data-line-id={l.id}>
                    <LineCells l={l} />
                    <td>
                      {l.state}
                      {l.budgetLineCode ? ` → ${l.budgetLineCode}` : ''}
                      {l.reason ? ` (${l.reason})` : ''}
                      {l.pending ? ' · pending recompute' : ''}
                    </td>
                    <td className="muted text-xs">
                      {l.decisionId ? 'decision' : l.ruleName ? `rule: ${l.ruleName}` : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <a href={`/grants/${id}/review?show=all`} className="btn btn-secondary btn-sm">
            Show settled {TERMS.transactionsLower}
          </a>
        )}
      </div>
    </>
  );
}
