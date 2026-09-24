import { extractNumbers } from './numbers';
import type { GroundingPacket } from './packet';
import type { NarrativeDraft } from './schema';

export type Verification = ReturnType<typeof verifyDraft>[number];
export function verifyDraft(draft: NarrativeDraft, packet: GroundingPacket) {
  return draft.sections.flatMap((section, sectionIndex) =>
    extractNumbers(section.body).map((token) => {
      const values =
        token.kind === 'currency' ? packet.derived.currency : packet.derived.percentage;
      const tol = token.kind === 'currency' ? 1 : 0.100001;
      const match = Object.entries(values).find(
        ([, value]) => Math.abs(value - token.value) <= tol,
      );
      return {
        sectionIndex,
        text: token.text,
        kind: token.kind,
        value: token.value,
        start: token.start,
        end: token.end,
        matched: !!match,
        matchedKey: match?.[0],
      };
    }),
  );
}
