import Link from 'next/link';
import { FormBanner } from '@/components/form';
import { Banner, FilterBar, Money } from '@/components/ui';
import type { FormState } from '@/lib/forms';
import type { GrantQueue, QueueFilters } from '@/services/review-queue';
import {
  DESTINATION_UNSET_MESSAGE,
  GRANT_CODING_MISSING_MESSAGE,
} from '@/services/correcting-entries';

export type QueueSearchParams = QueueFilters & {
  f?: string;
  saved?: string;
  drafted?: string;
  blocked?: string;
  draftError?: string;
  accepted?: string;
  excluded?: string;
};

export function queueFilters(sp: QueueSearchParams): QueueFilters {
  const f: QueueFilters = {};
  for (const k of ['reason', 'account', 'name', 'from', 'to', 'suggested'] as const)
    if (sp[k]) f[k] = sp[k];
  return f;
}

export function hasFilters(f: QueueFilters): boolean {
  return Object.values(f).some(Boolean);
}

/** "8 transactions need a decision · $1,188.41" */
export function QueueHeadline({ count, totalCents }: { count: number; totalCents: number }) {
  return (
    <h2 className="mb-3" data-testid="queue-header">
      <span data-testid="queue-count">{count}</span>{' '}
      {count === 1 ? 'transaction needs' : 'transactions need'} a decision ·{' '}
      <Money cents={totalCents} dollar data-testid="queue-total" />
    </h2>
  );
}

/** Saved / drafted / blocked banners shared by both queue pages. */
export function QueueBanners({
  sp,
  state,
  entriesHref,
  editGrantHref,
}: {
  sp: QueueSearchParams;
  state: FormState | null;
  entriesHref: string | null;
  editGrantHref: string | null;
}) {
  const { saved, drafted, blocked, draftError, accepted, excluded } = sp;
  return (
    <>
      <FormBanner state={state} saved={!!saved && !drafted && !blocked && !draftError && !accepted && !excluded} />
      {accepted ? (
        <div data-testid="bulk-accepted">
          <Banner tone="ok">
            Accepted {accepted} {accepted === '1' ? 'transaction' : 'transactions'}.
          </Banner>
        </div>
      ) : null}
      {excluded && !drafted && !blocked && !draftError ? (
        <div data-testid="bulk-excluded">
          <Banner tone="ok">
            Excluded {excluded} {excluded === '1' ? 'transaction' : 'transactions'} as not grant-funded.
          </Banner>
        </div>
      ) : null}
      {drafted ? (
        <div data-testid="draft-created">
          <Banner tone="ok">
            {excluded ? `Excluded ${excluded} ${excluded === '1' ? 'transaction' : 'transactions'} as not grant-funded; correcting` : 'Correcting'}{' '}
            entry <code>{drafted}</code> drafted
            {entriesHref ? (
              <>
                {' '}
                — <Link href={entriesHref}>open entries</Link>
              </>
            ) : null}
            .
          </Banner>
        </div>
      ) : null}
      {blocked || draftError ? (
        <div data-testid="draft-blocked">
          <Banner tone="warn">
            Exclusion saved, but no correcting entry was drafted:{' '}
            {blocked === 'grant'
              ? GRANT_CODING_MISSING_MESSAGE
              : blocked
                ? DESTINATION_UNSET_MESSAGE
                : draftError}{' '}
            {blocked === 'grant' && editGrantHref ? (
              <Link href={editGrantHref}>Edit grant</Link>
            ) : blocked ? (
              <Link href="/settings#destination">Open settings</Link>
            ) : null}
          </Banner>
        </div>
      ) : null}
    </>
  );
}

export function QueueFilterBar({
  action,
  filters,
  grants,
}: {
  action: string;
  filters: QueueFilters;
  grants: GrantQueue[];
}) {
  const uniq = (xs: string[]) => [...new Set(xs)].sort((a, b) => a.localeCompare(b));
  const reasons = uniq(grants.flatMap((g) => g.options.reasons));
  const accountIds = uniq(grants.flatMap((g) => g.options.accounts));
  const accountLabel = new Map<string, string>();
  for (const g of grants)
    for (const l of g.queue.groups.flatMap((x) => x.lines)) accountLabel.set(l.accountId, l.account);
  return (
    <div className="mb-3" data-testid="queue-filters">
      <FilterBar action={action}>
        <label>
          Reason
          <select name="reason" defaultValue={filters.reason ?? ''}>
            <option value="">Any</option>
            {reasons.map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </select>
        </label>
        <label>
          Account
          <select name="account" defaultValue={filters.account ?? ''}>
            <option value="">Any</option>
            {accountIds.map((id) => (
              <option key={id} value={id}>
                {accountLabel.get(id) ?? id}
              </option>
            ))}
          </select>
        </label>
        <label>
          Name
          <input name="name" defaultValue={filters.name ?? ''} placeholder="contains…" />
        </label>
        <label>
          From
          <input type="date" name="from" defaultValue={filters.from ?? ''} />
        </label>
        <label>
          To
          <input type="date" name="to" defaultValue={filters.to ?? ''} />
        </label>
        <label>
          Suggestion
          <select name="suggested" defaultValue={filters.suggested ?? ''}>
            <option value="">Any</option>
            <option value="1">Has a suggestion</option>
            <option value="0">No suggestion</option>
          </select>
        </label>
        {hasFilters(filters) ? (
          <Link href={action} className="btn btn-ghost btn-sm">
            Clear
          </Link>
        ) : null}
      </FilterBar>
    </div>
  );
}
