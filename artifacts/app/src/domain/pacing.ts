import { formatPct1, roundHalfUpDiv } from './money';

const DAY = 86_400_000;
export function pacing(
  awardCents: number,
  actualCents: number,
  start: Date,
  end: Date,
  asOf: Date,
  underPercent = 15,
  overPercent = 10,
) {
  const totalDays = Math.floor((end.getTime() - start.getTime()) / DAY) + 1;
  const elapsedDays = Math.max(
    0,
    Math.min(totalDays, Math.floor((asOf.getTime() - start.getTime()) / DAY) + 1),
  );
  const expectedCents = roundHalfUpDiv(awardCents * elapsedDays, totalDays);
  const varianceCents = actualCents - expectedCents;
  const flag =
    varianceCents < (-expectedCents * underPercent) / 100
      ? 'under'
      : varianceCents > (expectedCents * overPercent) / 100
        ? 'over'
        : 'on pace';
  return {
    totalDays,
    elapsedDays,
    expectedCents,
    varianceCents,
    variancePct: formatPct1(varianceCents, expectedCents),
    flag,
  };
}

export function isOverBudget(actualCents: number, budgetCents: number) {
  return actualCents > budgetCents;
}
