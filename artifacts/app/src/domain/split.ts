/**
 * Largest-remainder split of an integer amount across weighted targets.
 *
 * - Works for any non-negative integer weights (basis points for fixed_pct
 *   rules, raw driver values for ratio_of_driver rules).
 * - Result always sums exactly to `amountCents`.
 * - Ties in remainder go to the lowest index (callers pass targets ordered by
 *   sortOrder, so this is "ties to lowest target sort order / ID").
 * - Negative amounts (reversals) are split by splitting |amount| and negating,
 *   so a reversal mirrors the original split exactly.
 */
export function splitLargestRemainder(
  amountCents: number,
  weights: ReadonlyArray<number>,
): number[] {
  if (!Number.isInteger(amountCents)) throw new Error('amountCents must be an integer');
  if (weights.length === 0) throw new Error('At least one target is required');
  for (const w of weights) {
    if (!Number.isInteger(w) || w < 0)
      throw new Error(`Weights must be non-negative integers, got ${w}`);
  }
  const total = weights.reduce((a, b) => a + b, 0);
  if (total === 0) throw new Error('Weights sum to zero');

  if (amountCents < 0) return splitLargestRemainder(-amountCents, weights).map((v) => -v);

  const floors: number[] = [];
  const remainders: { index: number; rem: number }[] = [];
  let allocated = 0;
  for (let i = 0; i < weights.length; i++) {
    const w = weights[i]!;
    const exact = amountCents * w; // numerator; exact/total is the ideal share
    const floor = Math.floor(exact / total);
    floors.push(floor);
    allocated += floor;
    remainders.push({ index: i, rem: exact - floor * total });
  }
  let leftover = amountCents - allocated;
  // Sort by remainder desc, then by index asc (tie → lowest sort order).
  remainders.sort((a, b) => b.rem - a.rem || a.index - b.index);
  for (let k = 0; leftover > 0; k++) {
    const target = remainders[k % remainders.length]!;
    floors[target.index] = floors[target.index]! + 1;
    leftover--;
  }
  return floors;
}

export function assertSumsTo(parts: ReadonlyArray<number>, total: number): void {
  const sum = parts.reduce((a, b) => a + b, 0);
  if (sum !== total) throw new Error(`Split does not balance: ${sum} !== ${total}`);
}
