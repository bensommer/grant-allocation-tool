import { describe, expect, it } from 'vitest';
import { reportSchema } from './params';
import type { Fact } from './query';
import { reportSections } from './view';

const fact = (f: Partial<Fact>): Fact =>
  ({
    grant: 'A',
    grantBudgetLine: 'A-1',
    program: 'CT',
    glAccount: '6010 Wages',
    functionalCategory: 'program',
    month: '2026-01',
    amountCents: 100,
    ...f,
  }) as Fact;

const params = (extra: Record<string, unknown>) =>
  reportSchema.parse({ from: '2026-01-01', to: '2026-03-31', ...extra });

describe('reportSections column set', () => {
  it('keeps a column that nets to zero across mapping groups', () => {
    // Mapped +100 and unmapped −100 in the same program × GL cell would vanish from a pivot of
    // all facts; each group still has a nonzero amount there.
    const facts = [
      fact({ glAccount: '6210 Rent', amountCents: 100 }),
      fact({
        glAccount: '6210 Rent',
        amountCents: -100,
        grant: 'Unmapped',
        grantBudgetLine: 'Unmapped',
      }),
      fact({ glAccount: '6010 Wages', amountCents: 500 }),
    ];
    const grouped = reportSections(facts, params({ mapping: true }), []);
    expect(grouped).toHaveLength(1);
    const block = grouped[0]!.blocks[0]!;
    expect(block.total.cols).toEqual(['6010 Wages', '6210 Rent']);
    const [mapped, unmapped] = block.groups;
    expect(mapped!.view.actualFor('CT')).toBe(600);
    expect(unmapped!.view.actualFor('CT')).toBe(-100);
    expect(block.total.actualTotal).toBe(500);

    const sections = reportSections(facts, params({ rows: 'grantBudgetLine' }), []);
    for (const section of sections)
      for (const b of section.blocks) expect(b.total.cols).toEqual(['6010 Wages', '6210 Rent']);
  });

  it('keeps a column that nets to zero across pages', () => {
    const facts = [
      fact({ month: '2026-01', glAccount: '6210 Rent', amountCents: 250 }),
      fact({ month: '2026-02', glAccount: '6210 Rent', amountCents: -250 }),
      fact({ month: '2026-01', amountCents: 40 }),
    ];
    const [section] = reportSections(facts, params({ page: 'month' }), []);
    expect(section!.blocks.map((b) => b.pageKey)).toEqual(['2026-01', '2026-02']);
    for (const b of section!.blocks) expect(b.total.cols).toEqual(['6010 Wages', '6210 Rent']);
    expect(section!.blocks[0]!.total.actualTotal).toBe(290);
    expect(section!.blocks[1]!.total.actualTotal).toBe(-250);
  });
});
