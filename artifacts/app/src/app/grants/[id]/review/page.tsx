import { Fragment } from 'react';
import { notFound } from 'next/navigation';
import { PageHeader } from '@/components/page-header';
import { FormBanner } from '@/components/form';
import { Banner, DateText, KeyFigure, Money, NumTd, StatusPill } from '@/components/ui';
import { prisma } from '@/lib/db';
import { getOrgId } from '@/lib/org';
import { decodeFormState, pick } from '@/lib/forms';
import { budgetTree } from '@/services/grant-budget';
import { reviewQueue, type ReviewLine } from '@/services/review';
import {
  clearAtRiskAction,
  confirmReversalPairAction,
  recordDecisionAction,
  revertDecisionAction,
} from '../../actions';
import { GrantTabs } from '../tabs';

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

const HEADERS = ['Date', 'Doc', 'Account', 'Payee', 'Class', 'Description', 'Amount ($)'];

export default async function ReviewPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ f?: string; saved?: string; show?: string }>;
}) {
  const { id } = await params;
  const { f, saved, show } = await searchParams;
  const orgId = await getOrgId();
  const grant = await prisma.grant.findFirst({ where: { id, orgId } });
  if (!grant) notFound();
  const [queue, tree] = await Promise.all([reviewQueue(orgId, id), budgetTree(orgId, id)]);
  const state = decodeFormState(f);
  const targets = tree.all.filter((l) => l.kind !== 'funder_category');
  const activityName = new Map(tree.activities.map((a) => [a.id, a.name]));
  const targetLabel = (l: (typeof targets)[number]) =>
    l.kind === 'cell'
      ? `${l.code} — ${activityName.get(l.activityId ?? '') ?? '?'} / ${l.categoryKey}`
      : `${l.code} — ${l.name}`;
  const atRiskLines = [
    ...queue.assigned,
    ...queue.excluded,
    ...queue.groups.flatMap((g) => g.lines),
  ].filter((l) => l.atRisk);
  const showAll = show === 'all';

  return (
    <>
      <PageHeader
        title={`${grant.name} · review queue`}
        subtitle="Member lines the rules could not settle, grouped by reason. Tick lines and record a decision; decisions are kept by import fingerprint and survive re-imports."
      />
      <GrantTabs id={id} active="review" />
      <FormBanner state={state} saved={!!saved} />
      {queue.runId === null ? (
        <Banner tone="info">No compute run yet — run a recompute to populate the queue.</Banner>
      ) : null}
      {queue.stale ? (
        <Banner tone="warn">
          Configuration changed since the current run; recompute to refresh these states.
        </Banner>
      ) : null}

      <div className="mb-4 grid gap-3 md:grid-cols-4" data-testid="review-counts">
        <KeyFigure
          label="Needs review"
          value={<Money cents={queue.totals.needsReviewCents} dollar />}
          hint={<span data-testid="needs-review-count">{queue.counts.needsReview} lines</span>}
          tone={queue.counts.needsReview > 0 ? 'warn' : 'ok'}
        />
        <KeyFigure
          label="Assigned"
          value={<Money cents={queue.totals.assignedCents} dollar />}
          hint={`${queue.counts.assigned} lines`}
        />
        <KeyFigure
          label="Excluded"
          value={<Money cents={queue.totals.excludedCents} dollar />}
          hint={`${queue.counts.excluded} lines`}
        />
        <KeyFigure
          label="Members"
          value={<Money cents={queue.totals.memberCents} dollar />}
          hint={`${queue.counts.atRisk} flagged at risk`}
          tone={queue.counts.atRisk > 0 ? 'warn' : 'muted'}
        />
      </div>

      {queue.proposals.length > 0 ? (
        <div className="card mb-4" data-testid="proposals">
          <h2>Proposed reversal pairs</h2>
          <p className="muted text-sm">
            Same account, equal and opposite amounts. Confirming records a reversal-pair decision
            that excludes both lines with reason “reversal pair”.
          </p>
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
                  <th className="relative">
                    <span className="sr-only">Confirm</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {queue.proposals.map((p) => (
                  <Fragment key={p.positive.id}>
                    <tr data-pair={p.amountCents}>
                      <LineCells l={p.positive} />
                      <td>
                        {p.positive.state}
                        {p.positive.budgetLineCode ? ` → ${p.positive.budgetLineCode}` : ''}
                      </td>
                      <td rowSpan={2} className="align-middle">
                        <form action={confirmReversalPairAction.bind(null, id)}>
                          <input type="hidden" name="positiveId" value={p.positive.id} />
                          <input type="hidden" name="negativeId" value={p.negative.id} />
                          <input
                            type="hidden"
                            name="note"
                            value={`Reversal pair ±${(p.amountCents / 100).toFixed(2)} confirmed`}
                          />
                          <button type="submit" className="btn btn-sm">
                            Confirm pair
                          </button>
                        </form>
                      </td>
                    </tr>
                    <tr className="border-b-2 border-line">
                      <LineCells l={p.negative} />
                      <td>
                        {p.negative.state}
                        {p.negative.budgetLineCode ? ` → ${p.negative.budgetLineCode}` : ''}
                      </td>
                    </tr>
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}

      <form action={recordDecisionAction.bind(null, id)} className="card mb-4" id="decision-form">
        <h2>Needs review</h2>
        {queue.groups.length === 0 ? (
          <p className="muted text-sm" data-testid="queue-empty">
            Nothing waiting — every member line is assigned or excluded.
          </p>
        ) : null}
        {queue.groups.map((g) => (
          <section
            key={g.reason}
            className="mb-4"
            data-testid="review-group"
            data-reason={g.reason}
          >
            <h3 className="flex items-center gap-2">
              <span>{g.reason}</span>
              <StatusPill tone="warn">
                <span data-testid="group-count">{g.lines.length}</span> lines ·{' '}
                <Money cents={g.totalCents} />
              </StatusPill>
            </h3>
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
                    <th>Flags</th>
                  </tr>
                </thead>
                <tbody>
                  {g.lines.map((l) => (
                    <tr key={l.id} data-line-id={l.id}>
                      <td>
                        <input
                          type="checkbox"
                          name="lineIds"
                          value={l.id}
                          aria-label={`Select ${l.description ?? l.id}`}
                        />
                      </td>
                      <LineCells l={l} />
                      <td>
                        {l.atRisk ? <StatusPill tone="bad">at risk</StatusPill> : null}
                        {l.activityName ? (
                          <span className="muted text-xs">activity {l.activityName}</span>
                        ) : null}
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr>
                    <th colSpan={7}>{g.reason} total</th>
                    <th className="num" data-cents={g.totalCents}>
                      <Money cents={g.totalCents} />
                    </th>
                    <th className="relative">
                      <span className="sr-only">—</span>
                    </th>
                  </tr>
                </tfoot>
              </table>
            </div>
          </section>
        ))}
        {state?.errors['lineIds'] ? <p className="field-error">{state.errors['lineIds']}</p> : null}

        <h3>Decision for the selected lines</h3>
        <div className="grid-form">
          <div>
            <label htmlFor="kind">Decision</label>
            <select id="kind" name="kind" defaultValue={pick(state, 'kind', 'assign')} required>
              <option value="assign">Assign to a working line or cell</option>
              <option value="exclude">Exclude as not allowable</option>
              <option value="at_risk">Flag at risk</option>
            </select>
            {state?.errors['kind'] ? <p className="field-error">{state.errors['kind']}</p> : null}
          </div>
          <div>
            <label htmlFor="targetBudgetLineId">Target (assign)</label>
            <select
              id="targetBudgetLineId"
              name="targetBudgetLineId"
              defaultValue={pick(state, 'targetBudgetLineId', '')}
            >
              <option value="">— select —</option>
              {targets.map((t) => (
                <option key={t.id} value={t.id}>
                  {targetLabel(t)}
                </option>
              ))}
            </select>
            {state?.errors['targetBudgetLineId'] ? (
              <p className="field-error">{state.errors['targetBudgetLineId']}</p>
            ) : null}
          </div>
          <div>
            <label htmlFor="reason">Reason (required to exclude)</label>
            <input
              id="reason"
              name="reason"
              placeholder="not allowable"
              defaultValue={pick(state, 'reason', '')}
            />
            {state?.errors['reason'] ? (
              <p className="field-error">{state.errors['reason']}</p>
            ) : null}
          </div>
          <div className="md:col-span-2">
            <label htmlFor="note">Note (required)</label>
            <input id="note" name="note" defaultValue={pick(state, 'note', '')} />
            {state?.errors['note'] ? <p className="field-error">{state.errors['note']}</p> : null}
            {state?.errors['_'] ? <p className="field-error">{state.errors['_']}</p> : null}
          </div>
          <div>
            <button type="submit" className="btn">
              Record decision
            </button>
          </div>
        </div>
      </form>

      {atRiskLines.length > 0 ? (
        <form action={clearAtRiskAction.bind(null, id)} className="card mb-4" data-testid="at-risk">
          <h2>Flagged at risk</h2>
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
                <tr key={l.id}>
                  <td>
                    <input type="checkbox" name="lineIds" value={l.id} aria-label="Select" />
                  </td>
                  <LineCells l={l} />
                  <td>{l.state}</td>
                </tr>
              ))}
            </tbody>
          </table>
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
                    <tr key={d.id} data-decision-kind={d.kind}>
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
                      <td>{d.kind}</td>
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
          Settled lines{' '}
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
            Show settled lines
          </a>
        )}
      </div>
    </>
  );
}
