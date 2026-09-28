import { Fragment, type ReactNode } from 'react';
import Link from 'next/link';
import { DateText, Money, NumTd, StatusPill } from '@/components/ui';
import { TERMS } from '@/copy/terms';
import type { FormState } from '@/lib/forms';
import { pick } from '@/lib/forms';
import type { ReviewLine } from '@/services/review';
import {
  EXCLUDE_REASONS,
  type GrantQueue,
  type QueueGroup,
  type QueueLineRow,
  type QueuePairRow,
} from '@/services/review-queue';
import { DESTINATION_UNSET_MESSAGE } from '@/services/correcting-entries';
import {
  acceptSuggestionAction,
  bulkReviewAction,
  changeAssignmentAction,
  confirmPairAction,
  flagAtRiskAction,
  notGrantFundedAction,
} from '@/app/grants/review-actions';
import { QueueIsland } from './queue-island';

export const BULK_FORM_ID = 'bulk';
export const QUEUE_ROOT_ID = 'review-queue';

/** Amount above which the description folds behind a click (works without JavaScript). */
const DESCRIPTION_CHARS = 48;

const POPOVER =
  'absolute right-0 z-20 mt-1 w-80 rounded-md border border-line bg-white p-3 text-left text-sm shadow-card';

function Description({ text }: { text: string | null }) {
  if (!text) return <span className="muted">—</span>;
  if (text.length <= DESCRIPTION_CHARS) return <>{text}</>;
  return (
    <details className="description">
      <summary className="cursor-pointer list-none" title="Show the full description">
        {text.slice(0, DESCRIPTION_CHARS).trimEnd()}…
      </summary>
      <span className="block whitespace-pre-wrap">{text}</span>
    </details>
  );
}

function ReturnTo({ value }: { value: string }) {
  return <input type="hidden" name="returnTo" value={value} />;
}

function alwaysHref(row: QueueLineRow): string {
  const q = new URLSearchParams();
  const party = row.line.partyId ?? row.line.txnPartyId;
  if (party) q.set('partyId', party);
  q.set('accountId', row.line.accountId);
  const s = row.suggestion;
  if (row.ruleDescription) q.set('descriptionContains', row.ruleDescription);
  if (s.targetBudgetLineId) q.set('targetBudgetLineId', s.targetBudgetLineId);
  if (s.activityId) q.set('activityId', s.activityId);
  if (s.categoryKey) q.set('categoryKey', s.categoryKey);
  q.set('returnTo', `/grants/${row.grantId}/review`);
  return `/grants/${row.grantId}/rules/new?${q.toString()}`;
}

function TargetPicker({ grant, row, state }: { grant: GrantQueue; row: QueueLineRow; state: FormState | null }) {
  const cells = grant.targets.filter((t) => t.kind === 'cell');
  const workingLines = grant.targets.filter((t) => t.kind === 'working_line');
  const mine = state?.values['lineId'] === row.line.id ? state : null;
  if (cells.length > 0 && workingLines.length === 0) {
    return (
      <>
        <label className="block">
          <span className="block text-xs font-semibold">Activity</span>
          <select name="activityId" defaultValue={pick(mine, 'activityId', row.suggestion.activityId ?? '')} required>
            <option value="">— pick —</option>
            {grant.activities.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>
        </label>
        <label className="mt-2 block">
          <span className="block text-xs font-semibold">Category</span>
          <select name="categoryKey" defaultValue={pick(mine, 'categoryKey', row.suggestion.categoryKey ?? '')} required>
            <option value="">— pick —</option>
            {grant.categories.map((c) => (
              <option key={c.key} value={c.key}>
                {c.label}
              </option>
            ))}
          </select>
        </label>
        {mine?.errors['categoryKey'] ? <p className="field-error">{mine.errors['categoryKey']}</p> : null}
      </>
    );
  }
  return (
    <label className="block">
      <span className="block text-xs font-semibold">
        {cells.length > 0 ? `Working line or ${TERMS.cellLower}` : 'Working line'}
      </span>
      <select
        name="targetBudgetLineId"
        defaultValue={pick(mine, 'targetBudgetLineId', row.suggestion.targetBudgetLineId ?? '')}
        required
      >
        <option value="">— pick —</option>
        {grant.targets.map((t) => (
          <option key={t.id} value={t.id}>
            {t.label}
          </option>
        ))}
      </select>
      {mine?.errors['targetBudgetLineId'] ? (
        <p className="field-error">{mine.errors['targetBudgetLineId']}</p>
      ) : null}
    </label>
  );
}

function ExcludeFields({ destinationSet, state, prefix }: { destinationSet: boolean; state: FormState | null; prefix: string }) {
  return (
    <>
      <label className="block">
        <span className="block text-xs font-semibold">Reason</span>
        <select name="reason" defaultValue={pick(state, 'reason', 'not allowable')} required>
          {EXCLUDE_REASONS.map((r) => (
            <option key={r} value={r}>
              {r}
            </option>
          ))}
        </select>
      </label>
      {state?.errors['reason'] ? <p className="field-error">{state.errors['reason']}</p> : null}
      <label className="mt-2 block">
        <span className="block text-xs font-semibold">Note (optional)</span>
        <input name="note" defaultValue={pick(state, 'note', '')} />
      </label>
      <label className="mt-2 flex items-start gap-2 text-sm font-normal">
        <input
          type="checkbox"
          name="draftEntry"
          defaultChecked={destinationSet && (state ? pick(state, 'draftEntry', '') === 'on' : true)}
          disabled={!destinationSet}
          aria-describedby={destinationSet ? undefined : `${prefix}-destination-hint`}
        />
        <span>
          Draft correcting entry
          {destinationSet ? null : (
            <span id={`${prefix}-destination-hint`} className="muted block text-xs">
              {DESTINATION_UNSET_MESSAGE} <Link href="/settings#destination">Open settings</Link>
            </span>
          )}
        </span>
      </label>
    </>
  );
}

function RowActions({
  grant,
  row,
  returnTo,
  destinationSet,
  state,
}: {
  grant: GrantQueue;
  row: QueueLineRow;
  returnTo: string;
  destinationSet: boolean;
  state: FormState | null;
}) {
  const s = row.suggestion;
  const mine = state?.values['lineId'] === row.line.id ? state : null;
  const hidden = (
    <>
      <input type="hidden" name="grantId" value={row.grantId} />
      <input type="hidden" name="lineId" value={row.line.id} />
      <ReturnTo value={returnTo} />
    </>
  );
  return (
    <div className="flex flex-wrap items-start gap-1">
      {s.targetBudgetLineId ? (
        <form action={acceptSuggestionAction} data-action="accept">
          {hidden}
          <input type="hidden" name="targetBudgetLineId" value={s.targetBudgetLineId} />
          <input type="hidden" name="reason" value={s.reason} />
          <button type="submit" className="btn btn-sm" title={`Assign to ${row.targetLabel}`}>
            Accept
          </button>
        </form>
      ) : null}
      <details className="relative" data-action="change" open={!!mine?.errors['targetBudgetLineId'] || !!mine?.errors['categoryKey'] || undefined}>
        <summary className="btn btn-secondary btn-sm cursor-pointer list-none">Change</summary>
        <form action={changeAssignmentAction} className={POPOVER}>
          {hidden}
          <TargetPicker grant={grant} row={row} state={state} />
          <label className="mt-2 block">
            <span className="block text-xs font-semibold">Note (optional)</span>
            <input name="note" defaultValue={pick(mine, 'note', '')} />
          </label>
          <button type="submit" className="btn btn-sm mt-3">
            Assign
          </button>
        </form>
      </details>
      <details className="relative" data-action="exclude" open={!!mine?.errors['reason'] || undefined}>
        <summary className="btn btn-secondary btn-sm cursor-pointer list-none">Not grant-funded</summary>
        <form action={notGrantFundedAction} className={POPOVER}>
          {hidden}
          <ExcludeFields destinationSet={destinationSet} state={mine} prefix={`x-${row.line.id}`} />
          <button type="submit" className="btn btn-sm mt-3">
            Exclude
          </button>
        </form>
      </details>
      <details className="relative" data-action="at-risk" open={!!mine?.errors['note'] || undefined}>
        <summary className="btn btn-ghost btn-sm cursor-pointer list-none">Flag at-risk</summary>
        <form action={flagAtRiskAction} className={POPOVER}>
          {hidden}
          <label className="block">
            <span className="block text-xs font-semibold">Why is it at risk? (required)</span>
            <input name="note" defaultValue={pick(mine, 'note', '')} required />
          </label>
          {mine?.errors['note'] ? <p className="field-error">{mine.errors['note']}</p> : null}
          <button type="submit" className="btn btn-sm mt-3">
            Flag
          </button>
        </form>
      </details>
      <Link href={alwaysHref(row)} className="btn btn-ghost btn-sm whitespace-nowrap" data-action="always">
        Always do this
      </Link>
    </div>
  );
}

function LineRow({
  grant,
  row,
  group,
  showGrant,
  returnTo,
  destinationSet,
  state,
}: {
  grant: GrantQueue;
  row: QueueLineRow;
  group: QueueGroup;
  showGrant: boolean;
  returnTo: string;
  destinationSet: boolean;
  state: FormState | null;
}) {
  const l = row.line;
  return (
    <tr
      data-row-id={l.id}
      data-line-id={l.id}
      data-grant-id={row.grantId}
      data-suggested={row.suggestion.targetBudgetLineId ?? undefined}
      data-confidence={row.suggestion.confidence ?? undefined}
    >
      <td>
        <input
          type="checkbox"
          name="rows"
          value={`${row.grantId}:${l.id}`}
          form={BULK_FORM_ID}
          data-group={`${row.grantId}:${group.key}`}
          aria-label={`Select ${l.party ?? l.description ?? l.id}`}
        />
      </td>
      {showGrant ? (
        <td>
          <Link href={`/grants/${row.grantId}/review`}>{row.grantName}</Link>
        </td>
      ) : null}
      <td className="whitespace-nowrap">
        <DateText date={l.txnDate} />
      </td>
      <td>
        {l.party ?? <span className="muted">—</span>}
        <span className="muted block text-xs">
          {l.txnType}
          {l.docNumber ? ` ${l.docNumber}` : ''}
        </span>
      </td>
      <td>{l.account}</td>
      <td className="max-w-xs">
        <Description text={l.description} />
      </td>
      <NumTd cents={l.amountCents} data-testid="row-amount" />
      <td data-testid="suggested">
        {row.targetLabel ? (
          <>
            <span className="font-semibold" data-testid="suggested-target">
              {row.targetLabel}
            </span>
            <span className="muted block text-xs" data-testid="suggested-reason">
              {row.suggestion.reason}
            </span>
          </>
        ) : (
          <>
            <span className="muted" data-testid="suggested-target">
              —
            </span>
            <span className="muted block text-xs" data-testid="suggested-reason">
              {row.suggestion.confidence === 'partial' ? row.suggestion.reason : row.reasonLabel}
            </span>
          </>
        )}
        {l.atRisk ? (
          <span className="block">
            <StatusPill tone="bad">at risk</StatusPill>
          </span>
        ) : null}
      </td>
      <td className="no-print">
        <RowActions grant={grant} row={row} returnTo={returnTo} destinationSet={destinationSet} state={state} />
      </td>
    </tr>
  );
}

function PairLines({ a, b, render }: { a: ReviewLine; b: ReviewLine; render: (l: ReviewLine) => ReactNode }) {
  return (
    <>
      <span className="block">{render(a)}</span>
      <span className="block">{render(b)}</span>
    </>
  );
}

function PairRow({
  row,
  showGrant,
  returnTo,
  group,
}: {
  row: QueuePairRow;
  showGrant: boolean;
  returnTo: string;
  group: QueueGroup;
}) {
  const { positive: p, negative: n } = row;
  return (
    <tr data-row-id={`${p.id}+${n.id}`} data-pair={row.amountCents} data-grant-id={row.grantId}>
      <td>
        <span className="sr-only">Pairs are confirmed one at a time</span>
      </td>
      {showGrant ? (
        <td>
          <Link href={`/grants/${row.grantId}/review`}>{row.grantName}</Link>
        </td>
      ) : null}
      <td className="whitespace-nowrap">
        <PairLines a={p} b={n} render={(l) => <DateText date={l.txnDate} />} />
      </td>
      <td>
        <PairLines
          a={p}
          b={n}
          render={(l) => (
            <>
              {l.party ?? '—'}
              <span className="muted text-xs">
                {' '}
                {l.txnType}
                {l.docNumber ? ` ${l.docNumber}` : ''}
              </span>
            </>
          )}
        />
      </td>
      <td>
        <PairLines a={p} b={n} render={(l) => l.account} />
      </td>
      <td className="max-w-xs">
        <PairLines a={p} b={n} render={(l) => <Description text={l.description} />} />
      </td>
      <td className="num" data-cents={0} data-testid="row-amount">
        <PairLines a={p} b={n} render={(l) => <Money cents={l.amountCents} />} />
      </td>
      <td data-testid="suggested">
        <span className="font-semibold" data-testid="suggested-target">
          Reversal pair
        </span>
        <span className="muted block text-xs" data-testid="suggested-reason">
          Same account, equal and opposite amounts (nets to $0.00)
        </span>
      </td>
      <td className="no-print">
        <form action={confirmPairAction} data-action="confirm-pair">
          <input type="hidden" name="grantId" value={row.grantId} />
          <input type="hidden" name="positiveId" value={p.id} />
          <input type="hidden" name="negativeId" value={n.id} />
          <input type="hidden" name="note" value={`Reversal pair ±${(row.amountCents / 100).toFixed(2)} confirmed`} />
          <ReturnTo value={returnTo} />
          <button type="submit" className="btn btn-sm">
            Confirm pair
          </button>
        </form>
      </td>
    </tr>
  );
}

function GroupHeader({
  grant,
  group,
  columns,
  showGrant,
}: {
  grant: GrantQueue;
  group: QueueGroup;
  columns: number;
  showGrant: boolean;
}) {
  const key = `${grant.grantId}:${group.key}`;
  const n = group.rows.length;
  return (
    <tr className="group-header" data-group-header={key} data-group-kind={group.kind}>
      <th colSpan={columns} className="bg-paper text-left text-xs font-semibold">
        <span className="flex flex-wrap items-center gap-3">
          {group.kind === 'suggested' ? (
            <label className="flex items-center gap-2 font-semibold">
              <input
                type="checkbox"
                name="groups"
                // The rows this header stands for, exactly as displayed (filters included): the
                // action never reaches transactions the reviewer could not see.
                value={`${grant.grantId}:${group.targetId}:${group.rows
                  .flatMap((r) => (r.kind === 'line' ? [r.line.id] : []))
                  .join(',')}`}
                form={BULK_FORM_ID}
                data-select-group={key}
              />
              Select all suggested → {group.label} ({n})
            </label>
          ) : (
            <span>
              {group.label} ({n})
            </span>
          )}
          {showGrant ? <span className="muted font-normal">{grant.grantName}</span> : null}
          {group.kind === 'pairs' ? (
            <span className="muted font-normal">
              Confirming records a reversal-pair decision that excludes both lines.
            </span>
          ) : (
            <span className="muted font-normal">
              <Money cents={group.totalCents} />
            </span>
          )}
        </span>
      </th>
    </tr>
  );
}

export function KeyLegend() {
  return (
    <p className="muted text-xs" data-testid="key-legend">
      Keys: <kbd>J</kbd>/<kbd>K</kbd> move · <kbd>A</kbd> accept · <kbd>C</kbd> change · <kbd>X</kbd> not
      grant-funded
    </p>
  );
}

/** Sticky bulk bar: the checkboxes in the rows post to this form. */
export function BulkBar({
  returnTo,
  destinationSet,
  state,
  suggestedCount,
}: {
  returnTo: string;
  destinationSet: boolean;
  state: FormState | null;
  suggestedCount: number;
}) {
  const bulkState = state?.values['intent'] !== undefined ? state : null;
  return (
    <form
      id={BULK_FORM_ID}
      action={bulkReviewAction}
      className="mb-2 flex flex-wrap items-center gap-2 text-sm"
      data-testid="bulk-bar"
    >
      <ReturnTo value={returnTo} />
      <span className="muted">
        <span data-bulk-count>0</span> selected
      </span>
      <button type="submit" name="intent" value="accept" className="btn btn-sm" data-testid="bulk-accept" disabled={suggestedCount === 0}>
        Accept <span data-bulk-count>selected</span>
      </button>
      <details className="relative" open={!!bulkState?.errors['reason'] || undefined}>
        <summary className="btn btn-secondary btn-sm cursor-pointer list-none" data-testid="bulk-exclude">
          Not grant-funded <span data-bulk-count>selected</span>
        </summary>
        <div className={POPOVER}>
          <ExcludeFields destinationSet={destinationSet} state={bulkState} prefix="bulk" />
          <button type="submit" name="intent" value="exclude" className="btn btn-sm mt-3">
            Exclude selected
          </button>
        </div>
      </details>
      {state?.errors['rows'] ? <p className="field-error">{state.errors['rows']}</p> : null}
      <KeyLegend />
    </form>
  );
}

export function QueueTable({
  grants,
  showGrant,
  returnTo,
  destinationSet,
  state,
  empty,
}: {
  grants: GrantQueue[];
  showGrant: boolean;
  returnTo: string;
  destinationSet: boolean;
  state: FormState | null;
  empty: ReactNode;
}) {
  const headers = [
    ...(showGrant ? ['Grant'] : []),
    'Date',
    'Name',
    'Account',
    'Description',
    'Amount ($)',
    'Suggested',
    'Actions',
  ];
  const columns = headers.length + 1;
  const rows = grants.reduce((n, g) => n + g.rows.length, 0);
  const suggestedCount = grants.reduce(
    (n, g) => n + g.rows.filter((r) => r.kind === 'line' && r.suggestion.targetBudgetLineId).length,
    0,
  );
  // A server action redirects back to this page; keying the island on the row set remounts it so
  // the focus marker and select-all wiring are rebuilt for the new rows after a soft navigation.
  const rowsKey = grants
    .flatMap((g) => g.rows.map((r) => (r.kind === 'line' ? r.line.id : `${r.positive.id}+${r.negative.id}`)))
    .join(',');
  return (
    <div id={QUEUE_ROOT_ID} data-testid="queue">
      <QueueIsland key={rowsKey} rootId={QUEUE_ROOT_ID} />
      <BulkBar returnTo={returnTo} destinationSet={destinationSet} state={state} suggestedCount={suggestedCount} />
      {rows === 0 ? (
        empty
      ) : (
        <div className="max-w-full overflow-x-auto">
          <table data-testid="queue-table">
            <thead>
              <tr>
                <th className="relative">
                  <span className="sr-only">Select</span>
                </th>
                {headers.map((h) => (
                  <th key={h} className={h.endsWith('($)') ? 'num' : ''}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {grants.map((g) =>
                g.groups.map((group) => (
                  <Fragment key={`${g.grantId}:${group.key}`}>
                    <GroupHeader grant={g} group={group} columns={columns} showGrant={showGrant} />
                    {group.rows.map((row) =>
                      row.kind === 'line' ? (
                        <LineRow
                          key={row.line.id}
                          grant={g}
                          row={row}
                          group={group}
                          showGrant={showGrant}
                          returnTo={returnTo}
                          destinationSet={destinationSet}
                          state={state}
                        />
                      ) : (
                        <PairRow
                          key={`${row.positive.id}+${row.negative.id}`}
                          row={row}
                          group={group}
                          showGrant={showGrant}
                          returnTo={returnTo}
                        />
                      ),
                    )}
                  </Fragment>
                )),
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
