import { formatDateTime } from '@/domain/format';

/**
 * One-line notice for report-type pages only (Reports, BvA, Restricted, Dashboard); the header
 * status indicator is the single place that tells the user to recompute.
 */
export function StaleRunBanner({
  run,
}: {
  run: { stale: boolean; finishedAt: Date | null; startedAt: Date } | null | undefined;
}) {
  if (!run?.stale) return null;
  return (
    <p className="banner banner-warn text-xs" data-stale-banner>
      Configuration changed since the current run — numbers below are from{' '}
      <span data-volatile>{formatDateTime(run.finishedAt ?? run.startedAt)}</span> until you
      recompute.
    </p>
  );
}
