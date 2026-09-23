import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { splitLargestRemainder } from './split';

describe('splitLargestRemainder', () => {
  it('1000 cents at 3333/3333/3334 bps sums to 1000, remainder to largest then lowest index', () => {
    // exact shares: 333.3, 333.3, 333.4 → floors 333,333,333; 1 leftover → index 2 (largest remainder)
    expect(splitLargestRemainder(1000, [3333, 3333, 3334])).toEqual([333, 333, 334]);
  });

  it('ties go to the lowest index', () => {
    // 100 at 1/3 each → 33,33,33 + 1 leftover; all remainders equal → index 0
    expect(splitLargestRemainder(100, [1, 1, 1])).toEqual([34, 33, 33]);
    // 5 at 50/50 → 2,2 + 1 → index 0
    expect(splitLargestRemainder(5, [5000, 5000])).toEqual([3, 2]);
  });

  it('reversals mirror the original split', () => {
    expect(splitLargestRemainder(-1000, [3333, 3333, 3334])).toEqual([-333, -333, -334]);
    expect(splitLargestRemainder(-100, [1, 1, 1])).toEqual([-34, -33, -33]);
  });

  it('golden: March utilities 600.01 at 50/20/30', () => {
    expect(splitLargestRemainder(60001, [5000, 2000, 3000])).toEqual([30001, 12000, 18000]);
  });

  it('zero-weight targets get nothing', () => {
    expect(splitLargestRemainder(999, [0, 1])).toEqual([0, 999]);
  });

  it('rejects invalid input', () => {
    expect(() => splitLargestRemainder(100, [])).toThrow();
    expect(() => splitLargestRemainder(100, [0, 0])).toThrow();
    expect(() => splitLargestRemainder(100.5, [1])).toThrow();
    expect(() => splitLargestRemainder(100, [-1, 2])).toThrow();
  });

  it('property: always sums exactly and never deviates more than 1 cent from ideal', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: -10_000_000, max: 10_000_000 }),
        fc.array(fc.integer({ min: 0, max: 10_000 }), { minLength: 1, maxLength: 8 }),
        (amount, weights) => {
          fc.pre(weights.some((w) => w > 0));
          const parts = splitLargestRemainder(amount, weights);
          const total = weights.reduce((a, b) => a + b, 0);
          expect(parts.reduce((a, b) => a + b, 0)).toBe(amount);
          parts.forEach((p, i) => {
            const ideal = (amount * weights[i]!) / total;
            expect(Math.abs(p - ideal)).toBeLessThan(1);
          });
        },
      ),
    );
  });
});
