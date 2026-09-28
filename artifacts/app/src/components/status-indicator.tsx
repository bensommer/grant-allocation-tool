import Link from 'next/link';
import { TERMS } from '@/copy/terms';
import { formatDate } from '@/domain/format';
import { freshnessLabel } from '@/domain/freshness';
import type { getGlobalStatus } from '@/lib/status';

type GlobalStatus = Awaited<ReturnType<typeof getGlobalStatus>>;

const TONE: Record<GlobalStatus['state'], string> = {
  fresh: 'pill pill-ok',
  updating: 'pill pill-info',
  failed: 'pill pill-bad',
  needs_update: 'pill pill-warn',
  none: 'pill pill-muted',
};

/**
 * The one place the app reports data freshness (JPH-28 D3): books through, and a chip that says
 * when the numbers were last updated. The chip links to the activity log; there is no button —
 * calculations run by themselves after every change.
 */
export function StatusIndicator({ status }: { status: GlobalStatus }) {
  const label = freshnessLabel(status.state, status.updatedAt, status.ageMs);
  return (
    <div
      className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-ink-soft"
      data-status-indicator
    >
      <span>
        Books through{' '}
        {status.booksThrough ? formatDate(status.booksThrough) : 'no imported transactions'}
      </span>
      <span aria-hidden="true">·</span>
      <Link
        href="/activity"
        className={`${TONE[status.state]} no-underline`}
        data-volatile
        data-testid="freshness-chip"
        data-state={status.state}
        data-stale={status.state === 'needs_update' ? '' : undefined}
        title={`Open the ${TERMS.activityLog.toLowerCase()}`}
      >
        {label}
      </Link>
    </div>
  );
}
