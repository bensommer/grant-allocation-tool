import { TERMS } from '@/copy/terms';
import { formatDate, formatMoney } from '@/domain/format';
import type { RulePreviewData } from './types';

/** "Matches 12 transactions · $7,100.00 in Jan 1 – Mar 31, 2026". */
export function previewSummary(p: RulePreviewData): string {
  const noun = p.count === 1 ? TERMS.transaction : TERMS.transactionsLower;
  return `Matches ${p.count} ${noun} · ${formatMoney(p.totalCents, { dollar: true, zero: 'zero' })} in ${p.periodLabel}`;
}

/**
 * Preview panel: server-rendered after the no-JS Preview button (and on load when the form is
 * pre-filled), re-rendered by the island after every change. Same markup either way.
 */
export function PreviewPanel({
  preview,
  pending,
  error,
}: {
  preview: RulePreviewData | null;
  pending?: boolean;
  error?: string | null;
}) {
  return (
    <section
      className="card rule-preview"
      data-testid="rule-preview"
      aria-live="polite"
      aria-busy={pending ? 'true' : undefined}
    >
      <h2>Preview</h2>
      {error ? <p className="field-error">{error}</p> : null}
      {preview ? (
        <>
          <p data-testid="preview-summary">
            Matches <span data-testid="preview-count">{preview.count}</span>{' '}
            {preview.count === 1 ? TERMS.transaction : TERMS.transactionsLower} ·{' '}
            <span data-cents={preview.totalCents}>
              {formatMoney(preview.totalCents, { dollar: true, zero: 'zero' })}
            </span>{' '}
            in {preview.periodLabel}
          </p>
          {preview.warning ? (
            <p className="banner banner-warn" data-testid="superset-warning" role="status">
              {preview.warning}
            </p>
          ) : null}
          {preview.rows.length > 0 ? (
            <div className="table-wrap overflow-x-auto">
              <table className="rule-preview-rows">
                <caption className="sr-only">First matching {TERMS.transactionsLower}</caption>
                <thead>
                  <tr>
                    <th scope="col">Date</th>
                    <th scope="col">{TERMS.name}</th>
                    <th scope="col">Account</th>
                    <th scope="col" className="num">
                      Amount ($)
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {preview.rows.map((r) => (
                    <tr key={r.id}>
                      <td>{formatDate(new Date(r.date))}</td>
                      <td>
                        {r.name ?? '—'}
                        {r.description ? (
                          <span className="muted block text-xs">{r.description}</span>
                        ) : null}
                      </td>
                      <td>{r.account}</td>
                      <td className="num" data-cents={r.amountCents}>
                        {formatMoney(r.amountCents)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="muted text-sm">No {TERMS.transactionsLower} match yet.</p>
          )}
        </>
      ) : (
        <p className="muted text-sm">
          {pending ? 'Checking…' : `Add a condition to see matching ${TERMS.transactionsLower}.`}
        </p>
      )}
    </section>
  );
}
