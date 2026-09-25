import Link from 'next/link';
import { DataTable, DateText, Money, NumTd, StatusPill, Td, Th, TotalRow } from '@/components/ui';
import { TIE_OUT_INLINE_LINES, type TieOut } from '@/services/grant-workspace';

/**
 * Tie-out as a mini ledger: assigned + excluded + needs review = coded to the grant,
 * then effort on its own line and the charged total. Audit rows show zeros as 0.00.
 * Green only when nothing is waiting; a proposed reversal pair still needs a reviewer.
 */
export function TieOutPanel({ id, tieOut: t }: { id: string; tieOut: TieOut }) {
  const sum = t.assignedCents + t.excludedCents + t.needsReviewCents;
  const ties = sum === t.codedCents;
  const reviewHref = `/grants/${id}/review`;
  return (
    <div data-testid="tie-out" data-green={t.green ? '1' : '0'} data-status={t.status}>
      <div className="mb-3 flex flex-wrap items-center gap-3" data-testid="tie-out-status">
        {t.status === 'clean' && (
          <StatusPill tone="ok" icon="✓">
            Ties out — nothing waiting for review
          </StatusPill>
        )}
        {t.status === 'pairs' && (
          <StatusPill tone="warn" icon="○">
            {t.pendingPairs} pair{t.pendingPairs === 1 ? '' : 's'} to confirm (nets{' '}
            <Money cents={t.needsReviewCents} zero="zero" dollar />)
          </StatusPill>
        )}
        {t.status === 'open' && (
          <StatusPill tone="warn">
            {t.needsReviewCount} line{t.needsReviewCount === 1 ? '' : 's'} waiting for review
          </StatusPill>
        )}
        {t.stale && <StatusPill tone="muted">run is stale</StatusPill>}
        <Link href={reviewHref} className="text-sm">
          Open review queue →
        </Link>
        <a href={`/grants/${id}/tie-out/pdf`} className="text-sm" data-testid="tie-out-pdf">
          PDF
        </a>
      </div>

      {t.status === 'open' && t.waiting.length > 0 && (
        <ul className="mb-3 text-sm" data-testid="tie-out-waiting">
          {t.waiting.map((l) => (
            <li
              key={l.id}
              className="flex flex-wrap gap-x-3 border-b border-line py-1"
              data-testid="tie-waiting-line"
            >
              <span className="muted">
                <DateText date={l.txnDate} />
              </span>
              <span className="min-w-0 flex-1 truncate">
                {l.description ?? l.party ?? l.account}
              </span>
              <Money cents={l.amountCents} />
            </li>
          ))}
          {t.needsReviewCount - t.pairedCount > TIE_OUT_INLINE_LINES && (
            <li className="muted py-1 text-xs">
              and {t.needsReviewCount - t.pairedCount - TIE_OUT_INLINE_LINES} more in the{' '}
              <Link href={reviewHref}>review queue</Link>
            </li>
          )}
        </ul>
      )}

      <div className="ledger">
        <DataTable>
          <thead>
            <tr>
              <Th aria-label="Operator" />
              <Th>Line</Th>
              <Th num>Amount ($)</Th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <Td className="op"> </Td>
              <Td>Assigned to budget lines</Td>
              <NumTd cents={t.assignedCents} zero="zero" data-testid="tie-assigned" />
            </tr>
            <tr>
              <Td className="op">+</Td>
              <Td>
                Excluded
                <span className="muted ml-2 text-xs">
                  {t.excluded.reduce((n, e) => n + e.count, 0)} line
                  {t.excluded.reduce((n, e) => n + e.count, 0) === 1 ? '' : 's'}
                  {t.excluded.length > 0 && ' — reasons below'}
                </span>
              </Td>
              <NumTd cents={t.excludedCents} zero="zero" data-testid="tie-excluded-total" />
            </tr>
            <tr>
              <Td className="op">+</Td>
              <Td>
                Needs review
                {t.needsReviewCount > 0 && (
                  <span className="muted ml-2 text-xs">
                    {t.needsReviewCount} line{t.needsReviewCount === 1 ? '' : 's'}
                    {t.pairedCount > 0 && `, ${t.pairedCount} in proposed reversal pairs`}
                  </span>
                )}
              </Td>
              <NumTd cents={t.needsReviewCents} zero="zero" data-testid="tie-needs-review" />
            </tr>
            <tr className="ledger-sum">
              <Td className="op">=</Td>
              <Th scope="row">
                Coded to the grant (member lines, current run){' '}
                {ties ? (
                  <span className="check-ok text-xs" aria-label="sum ties to coded">
                    ✓
                  </span>
                ) : (
                  <span className="text-bad text-xs">
                    does not tie: rows sum to <Money cents={sum} zero="zero" dollar />
                  </span>
                )}
              </Th>
              <NumTd cents={t.codedCents} zero="zero" dollar data-testid="tie-coded" />
            </tr>
            <tr>
              <Td className="op"> </Td>
              <Td>Effort charges (not booked lines; effort schedules)</Td>
              <NumTd cents={t.effortCents} zero="zero" data-testid="tie-effort" />
            </tr>
            <TotalRow>
              <Td className="op">=</Td>
              <Th scope="row">Charged to budget lines (assigned + effort)</Th>
              <NumTd cents={t.chargedCents} zero="zero" dollar data-testid="tie-charged" />
            </TotalRow>
          </tbody>
        </DataTable>
      </div>
      {/* Hidden mirror of the ledger sum so tests and scripts can read it without arithmetic. */}
      <span hidden data-testid="tie-sum" data-cents={sum} />

      <details className="breakdown mt-2" data-testid="tie-out-excluded">
        <summary>
          Excluded by reason ({t.excluded.length} reason{t.excluded.length === 1 ? '' : 's'})
        </summary>
        {t.excluded.length === 0 ? (
          <p className="muted text-sm">Nothing excluded in the current run.</p>
        ) : (
          <DataTable>
            <thead>
              <tr>
                <Th>Reason</Th>
                <Th num>Lines</Th>
                <Th num>Amount ($)</Th>
              </tr>
            </thead>
            <tbody>
              {t.excluded.map((e) => (
                <tr key={e.reason}>
                  <Td>Excluded — {e.reason}</Td>
                  <Td className="num">{e.count}</Td>
                  <NumTd cents={e.cents} zero="zero" data-testid="tie-excluded" />
                </tr>
              ))}
            </tbody>
          </DataTable>
        )}
      </details>
      <p className="muted mt-2 text-xs">
        Green needs nothing waiting for review. Lines in a proposed reversal pair net to zero but
        still need a reviewer to confirm the pair.
      </p>
    </div>
  );
}
