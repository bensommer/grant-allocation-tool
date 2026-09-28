/** The two views of Budget vs. Actuals (JPH-29 E2). */
export type BvaView = 'funder' | 'internal';

export function bvaView(raw: string | undefined): BvaView {
  return raw === 'internal' ? 'internal' : 'funder';
}

/** Query keys the page understands; the forecast strip's own keys pass through unchanged. */
const KNOWN = ['asOf', 'view', 'mode', 'months'] as const;

/**
 * Rebuild the page query with `patch` applied (undefined deletes). Forecast-strip parameters
 * (line, to, countN…) are kept so switching Totals ↔ By month does not lose a plan.
 */
export function bvaQuery(
  sp: Record<string, string | undefined>,
  patch: Record<string, string | undefined>,
): string {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(sp)) if (v !== undefined && v !== '') q.set(k, v);
  for (const [k, v] of Object.entries(patch)) {
    if (v === undefined) q.delete(k);
    else q.set(k, v);
  }
  // Normalise order: known keys first so URLs are stable in tests and links.
  const out = new URLSearchParams();
  for (const k of KNOWN) if (q.has(k)) out.set(k, q.get(k)!);
  for (const [k, v] of q) if (!KNOWN.includes(k as (typeof KNOWN)[number])) out.append(k, v);
  return out.toString();
}

/** Export filename stem: `budget-vs-actuals-<view>-<label>`. */
export function bvaFilename(view: BvaView, label: string, ext: string): string {
  return `budget-vs-actuals-${view}-${label}.${ext}`;
}
