import { getOrgId } from '@/lib/org';
import { getNarrative, parseDraft } from '@/narratives/service';
import type { GroundingPacket } from '@/narratives/packet';
import { pdfDocument, pdfErrorResponse, pdfResponse } from '@/reports/pdf';

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string; nid: string }> },
) {
  const { id, nid } = await context.params;
  const narrative = await getNarrative(await getOrgId(), id, nid);
  if (!narrative) return new Response('Narrative not found', { status: 404 });
  const packet = narrative.packetJson as unknown as GroundingPacket;
  const draft = parseDraft(narrative.editedJson ?? narrative.draftJson);
  try {
    const buf = await pdfDocument({
      title: packet.grant.name,
      subtitle: `${packet.period.from} – ${packet.period.to}`,
      parameters: { Template: narrative.template, Version: String(narrative.version) },
      portrait: true,
      sections: [
        ...draft.sections.map((section) => ({
          heading: section.heading,
          paragraphs: [section.body],
        })),
        {
          heading: 'Budget vs actual',
          table: {
            title: 'Budget vs actual',
            parameters: {},
            headers: ['Budget line', 'Budget', 'Actual', 'Remaining'],
            rows: packet.rows.map((row) => [
              `${row.code} · ${row.name}`,
              row.budgetCents,
              row.actualCents,
              row.remainingCents,
            ]),
            sumColumns: [1, 2, 3],
          },
        },
      ],
    });
    return pdfResponse(buf, `narrative-${nid}.pdf`);
  } catch (error) {
    return pdfErrorResponse(error);
  }
}
