import { StatusPill } from '@/components/ui';
import type { pacing } from '@/domain/pacing';

type Pace = ReturnType<typeof pacing>;

export function paceReason(pace: Pace, overBudgetLines: string[] = []) {
  const parts: string[] = [];
  if (pace.flag === 'over') parts.push(`Over pace: ${pace.variancePct} ahead of straight-line`);
  else if (pace.flag === 'under')
    parts.push(`Under pace: ${pace.variancePct.replace('-', '')} behind straight-line`);
  else parts.push('On pace');
  parts.push(...overBudgetLines.map((name) => `Over-budget line: ${name}`));
  return parts.join(' · ');
}

/**
 * The one pacing string for a grant (list chip, overview card, BvA status). Pass
 * `paced={figures.paced}`: an unrestricted gift is not measured against a
 * straight line, so it never reads "behind" (JPH-30).
 */
export function GrantPaceStatus({
  pace,
  overBudgetLines = [],
  paced = true,
}: {
  pace: Pace;
  overBudgetLines?: string[];
  paced?: boolean;
}) {
  if (!paced)
    return (
      <span data-testid="pace-status" data-flag="unpaced">
        <StatusPill tone={overBudgetLines.length ? 'bad' : 'muted'}>
          {overBudgetLines.length
            ? overBudgetLines.map((name) => `Over-budget line: ${name}`).join(' · ')
            : 'Unrestricted · not paced'}
        </StatusPill>
      </span>
    );
  return (
    <span data-testid="pace-status" data-flag={pace.flag}>
      <StatusPill tone={overBudgetLines.length ? 'bad' : pace.flag === 'on pace' ? 'ok' : 'warn'}>
        {paceReason(pace, overBudgetLines)}
      </StatusPill>
    </span>
  );
}
