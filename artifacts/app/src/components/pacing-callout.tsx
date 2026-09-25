import { GrantPaceStatus } from '@/components/grant-pace-status';
import { DateText, PairedBar } from '@/components/ui';
import type { pacing } from '@/domain/pacing';
import type { HeaderMetrics } from '@/services/grant-workspace';

/**
 * Pace at a glance: a thin paired bar (time elapsed vs. share of the award spent),
 * the same three numbers in words, and the months left. Colour only appears when the
 * grant is outside its pacing thresholds or a line is over budget.
 */
export function PacingCallout({
  metrics: m,
  pace,
  overBudgetLines = [],
  compact = false,
}: {
  metrics: HeaderMetrics;
  pace: ReturnType<typeof pacing>;
  overBudgetLines?: string[];
  compact?: boolean;
}) {
  const alarmed = pace.flag !== 'on pace' || overBudgetLines.length > 0;
  const pts = Math.abs(m.pacePts);
  const paceText =
    m.pacePts === 0
      ? 'on pace'
      : `${pts} pt${pts === 1 ? '' : 's'} ${m.pacePts < 0 ? 'behind' : 'ahead of'} pace`;
  return (
    <div data-testid="pacing-callout" data-pace-pts={m.pacePts}>
      <p className="text-sm" data-testid="pace-text">
        <span data-testid="elapsed-vs-spent">
          Spent {Math.round(m.spentBps / 100)}% · Time {Math.round(m.elapsedBps / 100)}%
        </span>{' '}
        · {paceText} ·{' '}
        <span data-testid="months-left" data-months={m.monthsLeft}>
          {m.monthsLeft} months left
        </span>
      </p>
      {!compact && (
        <PairedBar
          rows={[
            { label: 'Time', bps: m.elapsedBps },
            { label: 'Spent', bps: m.spentBps },
          ]}
          tone={alarmed ? 'warn' : 'neutral'}
        />
      )}
      <p className="muted mt-1 text-xs">
        As of <DateText date={m.asOf} />
        {alarmed && (
          <>
            {' '}
            <GrantPaceStatus pace={pace} overBudgetLines={overBudgetLines} />
          </>
        )}
      </p>
    </div>
  );
}
