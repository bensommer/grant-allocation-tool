import { Button } from '@/components/ui';
import { formatDate, formatDateTime } from '@/domain/format';
import { recomputeAndReturnAction } from '@/app/runs/actions';
import type { getGlobalStatus } from '@/lib/status';

type GlobalStatus = Awaited<ReturnType<typeof getGlobalStatus>>;

/** The one place the app reports data freshness: books, current run, and whether to recompute. */
export function StatusIndicator({ status, returnTo }: { status: GlobalStatus; returnTo: string }) {
  const run = status.currentRun;
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
      <span data-volatile>
        Run {run ? formatDateTime(run.finishedAt ?? run.startedAt) : 'none'}
      </span>
      {run?.stale ? (
        <>
          <span aria-hidden="true">·</span>
          <span className="pill pill-warn" data-stale>
            Recompute needed
          </span>
          <form action={recomputeAndReturnAction} className="inline">
            <input type="hidden" name="returnTo" value={returnTo} />
            <Button size="sm">Recompute</Button>
          </form>
        </>
      ) : null}
    </div>
  );
}
