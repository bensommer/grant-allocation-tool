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

export function GrantPaceStatus({
  pace,
  overBudgetLines = [],
}: {
  pace: Pace;
  overBudgetLines?: string[];
}) {
  return (
    <StatusPill tone={overBudgetLines.length ? 'bad' : pace.flag === 'on pace' ? 'ok' : 'warn'}>
      {paceReason(pace, overBudgetLines)}
    </StatusPill>
  );
}
