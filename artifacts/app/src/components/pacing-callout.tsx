import { GrantPaceStatus } from '@/components/grant-pace-status';
import { DateText, PairedBar } from '@/components/ui';
import type { GrantFigures } from '@/domain/grant-figures';

/**
 * Pace at a glance: a thin paired bar (time elapsed vs. share of the award spent),
 * the same three numbers in words, and the months left. Colour only appears when the
 * grant is outside its pacing thresholds or a line is over budget. Reads the grant's
 * figures (JPH-30), so the pace here is the pace on the grants list.
 */
export function PacingCallout({
  figures: m,
  overBudgetLines = [],
  compact = false,
}: {
  figures: GrantFigures;
  overBudgetLines?: string[];
  compact?: boolean;
}) {
  const pace = m.pacing;
  const alarmed = (m.paced && pace.flag !== 'on pace') || overBudgetLines.length > 0;
  const pts = Math.abs(m.pacePts);
  const paceText = !m.paced
    ? 'unrestricted · not paced'
    : m.pacePts === 0
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
            <GrantPaceStatus pace={pace} paced={m.paced} overBudgetLines={overBudgetLines} />
          </>
        )}
      </p>
    </div>
  );
}
