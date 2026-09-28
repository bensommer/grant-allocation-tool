import { formatDateTime } from '@/domain/format';

/**
 * One-line notice for report-type pages only (Reports, BvA, Restricted, Overview); the header
 * chip is the single place that reports freshness. Since JPH-28 D1 calculations run by
 * themselves, so this only shows in the brief window between a change and its calculation.
 */
export function StaleRunBanner({
  run,
}: {
  run: { stale: boolean; finishedAt: Date | null; startedAt: Date } | null | undefined;
}) {
  if (!run?.stale) return null;
  return (
    <p className="banner banner-warn text-xs" data-stale-banner>
      Something changed since the last calculation — numbers below are from{' '}
      <span data-volatile>{formatDateTime(run.finishedAt ?? run.startedAt)}</span> until the
      update finishes.
    </p>
  );
}
