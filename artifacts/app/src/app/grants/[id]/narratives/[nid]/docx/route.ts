import { getOrgId } from '@/lib/org';
import { getNarrative, parseDraft } from '@/narratives/service';
import { narrativeDocx } from '@/narratives/docx';
import type { GroundingPacket } from '@/narratives/packet';

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string; nid: string }> },
) {
  const { id, nid } = await context.params;
  const row = await getNarrative(await getOrgId(), id, nid);
  if (!row) return new Response('Narrative not found', { status: 404 });
  const buf = await narrativeDocx(
    row.packetJson as unknown as GroundingPacket,
    parseDraft(row.editedJson ?? row.draftJson),
  );
  return new Response(new Uint8Array(buf), {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'Content-Disposition': `attachment; filename="narrative-${nid}.docx"`,
    },
  });
}
