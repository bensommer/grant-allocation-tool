import Link from 'next/link';
import { notFound } from 'next/navigation';
import {
  Banner,
  Button,
  ButtonLink,
  Card,
  DataTable,
  DateText,
  Money,
  NumTd,
  PageHeader,
  Period,
  StatusPill,
  Td,
  Th,
} from '@/components/ui';
import { getOrgId } from '@/lib/org';
import { currentPeriod } from '@/lib/period';
import { grantHeader } from '@/services/grant-workspace';
import { grantTodo } from '@/services/grant-todo';
import { bulkReviewAction } from '@/app/grants/review-actions';
import { EditGrantButton } from '@/app/grants/[id]/edit-grant-button';
import { GrantTabs } from '../tabs';

export const dynamic = 'force-dynamic';

/** Waiting transactions shown inline before the "open the queue" link. */
const INLINE_ROWS = 5;

/**
 * To do (JPH-29 E1): the three things a grant can need from the CPA — decisions on
 * transactions, staff time that does not match payroll, and correcting entries drafted but not
 * posted. A section with nothing in it collapses to one green line.
 */
export default async function GrantTodoPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ saved?: string; asOf?: string }>;
}) {
  const { id } = await params;
  const sp = await searchParams;
  const orgId = await getOrgId();
  const grant = await grantHeader(orgId, id);
  if (!grant) notFound();
  const period = await currentPeriod(orgId, sp);
  const todo = await grantTodo(orgId, id, period);
  const { review } = todo;
  const lineRows = review.rows.filter((r) => r.kind === 'line');
  const suggested = lineRows.filter((r) => r.suggestion.targetBudgetLineId);
  const returnTo = `/grants/${id}/todo`;
  // Proposed reversal pairs net to zero and are confirmed, not decided; they do not keep the
  // grant on the to-do list (the review queue still lists them).
  const openReview = review.count - review.pairCount;
  const nothing = todo.openCount === 0;
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
      <GrantTabs id={id} active="todo" />
      {sp.saved && <Banner tone="ok">Saved.</Banner>}
      <p className="mb-4 text-base" data-testid="todo-header" data-open={todo.openCount}>
        {nothing ? (
          <>
            <StatusPill tone="ok" icon="✓">
              Nothing to do
            </StatusPill>{' '}
            — {todo.next ? todo.next.status : `this grant is up to date through ${period.label}.`}
          </>
        ) : (
          <>
            <strong>{todo.openCount}</strong> item{todo.openCount === 1 ? ' needs' : 's need'} a
            decision
            {todo.next ? <span className="muted"> · next: {todo.next.status}</span> : null}
          </>
        )}
      </p>

      {/* 1. Review */}
      <Card
        title={openReview > 0 ? `Review · ${review.count}` : 'Review'}
        action={
          <ButtonLink href={`/grants/${id}/review`} variant="secondary" size="sm">
            Open the review queue
          </ButtonLink>
        }
      >
        <div data-testid="todo-review" data-count={openReview} data-pairs={review.pairCount}>
          {openReview === 0 ? (
            <GreenLine>
              Nothing waiting for a decision.
              {review.pairCount > 0
                ? ` ${review.pairCount} proposed reversal pair${review.pairCount === 1 ? '' : 's'} can be confirmed in the review queue.`
                : ''}
            </GreenLine>
          ) : (
            <>
              <p className="muted mb-2 text-sm">
                {lineRows.length} transaction{lineRows.length === 1 ? '' : 's'} waiting for a
                decision
                {review.pairCount > 0
                  ? ` and ${review.pairCount} proposed reversal pair${review.pairCount === 1 ? '' : 's'} to confirm`
                  : ''}
                , <Money cents={review.totalCents} dollar /> in total.
              </p>
              <DataTable>
                <thead>
                  <tr>
                    <Th>Date</Th>
                    <Th>Account</Th>
                    <Th>Name</Th>
                    <Th>Suggested line</Th>
                    <Th num>Amount ($)</Th>
                  </tr>
                </thead>
                <tbody>
                  {lineRows.slice(0, INLINE_ROWS).map((r) => (
                    <tr key={r.line.id} data-testid="todo-review-row">
                      <Td>
                        <DateText date={r.line.txnDate} />
                      </Td>
                      <Td>{r.line.accountName}</Td>
                      <Td>{r.line.partyName ?? '—'}</Td>
                      <Td>{r.targetLabel ?? <span className="muted">{r.reasonLabel}</span>}</Td>
                      <NumTd cents={r.line.amountCents} />
                    </tr>
                  ))}
                </tbody>
              </DataTable>
              {lineRows.length > INLINE_ROWS ? (
                <p className="muted mt-2 text-sm">
                  {lineRows.length - INLINE_ROWS} more in the{' '}
                  <Link href={`/grants/${id}/review`}>review queue</Link>.
                </p>
              ) : null}
              {suggested.length > 0 ? (
                <form action={bulkReviewAction} className="mt-3" data-testid="todo-accept-all">
                  <input type="hidden" name="intent" value="accept" />
                  <input type="hidden" name="returnTo" value={returnTo} />
                  {suggested.map((r) => (
                    <input key={r.line.id} type="hidden" name="rows" value={`${id}:${r.line.id}`} />
                  ))}
                  <Button type="submit" size="sm">
                    Accept all {suggested.length} suggested
                  </Button>
                  <span className="muted ml-2 text-xs">
                    Assigns each transaction to the line the rules suggest.
                  </span>
                </form>
              ) : null}
            </>
          )}
        </div>
      </Card>

      {/* 2. Staff time vs. payroll */}
      <Card
        title="Staff time vs. payroll"
        action={
          <ButtonLink href={`/grants/${id}/effort`} variant="secondary" size="sm">
            {todo.effortAll.length > 0 ? 'Open effort' : 'Set up staff time'}
          </ButtonLink>
        }
      >
        <div data-testid="todo-effort" data-count={todo.effortOpen.length}>
          {todo.effortOpen.length === 0 ? (
            <GreenLine>
              {todo.effortAll.length === 0
                ? 'No staff time schedules on this grant.'
                : 'Staff time matches payroll.'}
            </GreenLine>
          ) : (
            <DataTable>
              <thead>
                <tr>
                  <Th>Person</Th>
                  <Th num>Variance ($)</Th>
                  <Th>Action</Th>
                </tr>
              </thead>
              <tbody>
                {todo.effortOpen.map((s) => (
                  <tr key={s.id} data-testid="todo-effort-row">
                    <Td>{s.personLabel}</Td>
                    <NumTd cents={s.varianceCents} data-testid="todo-effort-variance" />
                    <Td>
                      <Link href={`/grants/${id}/effort`}>Settle the variance</Link>
                    </Td>
                  </tr>
                ))}
              </tbody>
            </DataTable>
          )}
        </div>
      </Card>

      {/* 3. Correcting entries to post */}
      <Card
        title="Correcting entries to post"
        action={
          <ButtonLink href={`/grants/${id}/entries`} variant="secondary" size="sm">
            Open entries
          </ButtonLink>
        }
      >
        <div data-testid="todo-drafts" data-count={todo.drafts.length}>
          {todo.drafts.length === 0 ? (
            <GreenLine>No correcting entries waiting to be posted.</GreenLine>
          ) : (
            <DataTable>
              <thead>
                <tr>
                  <Th>Entry</Th>
                  <Th num>Amount ($)</Th>
                  <Th>Action</Th>
                </tr>
              </thead>
              <tbody>
                {todo.drafts.map((d) => (
                  <tr key={d.code} data-testid="todo-draft-row">
                    <Td>{d.code}</Td>
                    <NumTd cents={d.amountCents} />
                    <Td>
                      <Link href={`/grants/${id}/entries/${d.code}`}>Post in QuickBooks</Link>
                    </Td>
                  </tr>
                ))}
              </tbody>
            </DataTable>
          )}
        </div>
      </Card>
    </>
  );
}

function GreenLine({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-sm" data-testid="todo-green">
      <StatusPill tone="ok" icon="✓">
        Done
      </StatusPill>{' '}
      {children}
    </p>
  );
}
