import { formatMoney } from '@/domain/format';

/**
 * Human-readable audit rows (JPH-25 A8): "Field: old → new" with labels, cents as currency,
 * ids as names, and the raw JSON tucked behind a collapsed "Technical details".
 */

/** Names for id-valued fields, loaded once per page by the caller. */
export type NameLookup = Record<string, Map<string, string>>;

type FieldKind = 'cents' | 'date' | 'text' | 'id' | 'ids' | 'enum';
interface FieldSpec {
  label: string;
  kind: FieldKind;
  /** Key into the NameLookup for `id` / `ids` fields. */
  names?: string;
  /** Optional enum-value labels. */
  values?: Record<string, string>;
}

/** Bookkeeping fields nobody edits; never shown as a change. */
const HIDDEN = new Set(['id', 'orgId', 'grantId', 'createdAt', 'updatedAt']);

export const GRANT_FIELDS: Record<string, FieldSpec> = {
  name: { label: 'Name', kind: 'text' },
  funder: { label: 'Funder', kind: 'text' },
  funderPartyId: { label: "Funder's QuickBooks customer name", kind: 'id', names: 'party' },
  awardNumber: { label: 'Award number', kind: 'text' },
  startDate: { label: 'Start date', kind: 'date' },
  endDate: { label: 'End date', kind: 'date' },
  awardAmountCents: { label: 'Award amount', kind: 'cents' },
  restrictionType: {
    label: 'Restriction',
    kind: 'enum',
    values: {
      purpose: 'Purpose',
      time: 'Time',
      both: 'Purpose and time',
      unrestricted: 'Unrestricted',
    },
  },
  status: {
    label: 'Status',
    kind: 'enum',
    values: { draft: 'Draft', active: 'Active', closed: 'Closed', archived: 'Archived' },
  },
  revenueAccountId: { label: 'Revenue account', kind: 'id', names: 'account' },
  matchPartyIds: { label: "Funder's QuickBooks customer names", kind: 'ids', names: 'party' },
  matchClassIds: { label: 'Income classes for this grant', kind: 'ids', names: 'class' },
  memberClassIds: { label: 'Member classes', kind: 'ids', names: 'class' },
  memberPartyIds: { label: 'Member projects (customer names)', kind: 'ids', names: 'party' },
  qboClassName: { label: 'QuickBooks class', kind: 'text' },
  qboProjectName: { label: 'QuickBooks project', kind: 'text' },
  trackingMode: {
    label: 'Tracked by',
    kind: 'enum',
    values: { crosswalk: 'Crosswalk rules', membership: 'QuickBooks class / project' },
  },
  // Budget line fields
  code: { label: 'Code', kind: 'text' },
  budgetCents: { label: 'Budget', kind: 'cents' },
  programId: { label: 'Program', kind: 'id', names: 'program' },
  sortOrder: { label: 'Sort order', kind: 'text' },
  kind: {
    label: 'Kind',
    kind: 'enum',
    values: {
      funder_category: 'Funder category',
      working_line: 'Working line',
      cell: 'Activity × category',
    },
  },
  parentId: { label: 'Funder category', kind: 'id', names: 'budgetLine' },
  activityId: { label: 'Activity', kind: 'id', names: 'activity' },
  categoryKey: { label: 'Category', kind: 'text' },
  releaseClass: {
    label: 'Release class',
    kind: 'enum',
    values: { direct: 'Direct', staff: 'Staff', overhead: 'Overhead' },
  },
};

const DASH = '—';

function humanize(key: string) {
  const words = key.replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

export function formatFieldValue(key: string, value: unknown, names: NameLookup): string {
  if (value === null || value === undefined || value === '') return DASH;
  const spec = GRANT_FIELDS[key];
  const kind: FieldKind = spec?.kind ?? (Array.isArray(value) ? 'ids' : 'text');
  const lookup = (id: unknown) =>
    (spec?.names ? names[spec.names]?.get(String(id)) : undefined) ?? String(id);
  switch (kind) {
    case 'cents':
      return typeof value === 'number'
        ? formatMoney(value, { dollar: true, zero: 'zero' })
        : String(value);
    case 'date':
      return String(value).slice(0, 10);
    case 'id':
      return lookup(value);
    case 'ids':
      return Array.isArray(value) && value.length ? value.map(lookup).join(', ') : DASH;
    case 'enum':
      return spec?.values?.[String(value)] ?? String(value);
    default:
      return typeof value === 'object' ? JSON.stringify(value) : String(value);
  }
}

export function fieldLabel(key: string) {
  return GRANT_FIELDS[key]?.label ?? humanize(key);
}

export function HistoryDiff({
  before,
  after,
  names,
}: {
  before: unknown;
  after: unknown;
  names: NameLookup;
}) {
  const b = (before ?? {}) as Record<string, unknown>;
  const a = (after ?? {}) as Record<string, unknown>;
  const keys = [...new Set([...Object.keys(b), ...Object.keys(a)])].filter((k) => !HIDDEN.has(k));
  const changed = keys.filter((k) => JSON.stringify(b[k] ?? null) !== JSON.stringify(a[k] ?? null));
  return (
    <>
      {changed.length === 0 ? (
        <span className="muted">No field changes</span>
      ) : (
        <ul className="m-0 list-none p-0 text-sm" data-testid="history-changes">
          {changed.map((k) => (
            <li key={k} data-field={k}>
              <span className="font-medium">{fieldLabel(k)}</span>:{' '}
              <span className="text-ink-soft" data-testid="history-old">
                {before ? formatFieldValue(k, b[k], names) : DASH}
              </span>
              {' → '}
              <span data-testid="history-new">
                {after ? formatFieldValue(k, a[k], names) : DASH}
              </span>
            </li>
          ))}
        </ul>
      )}
      <details className="mt-1 text-xs">
        <summary className="muted cursor-pointer">Technical details</summary>
        <pre className="mt-1 max-w-xl overflow-x-auto whitespace-pre-wrap break-all">
          {JSON.stringify({ before: before ?? null, after: after ?? null }, null, 2)}
        </pre>
      </details>
    </>
  );
}
