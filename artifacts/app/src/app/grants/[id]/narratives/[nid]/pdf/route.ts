import { getOrgId } from '@/lib/org';
import { getNarrative } from '@/narratives/service';
import { pdfOfPage } from '@/reports/table-export';

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string; nid: string }> },
) {
  const { id, nid } = await context.params;
  if (!(await getNarrative(await getOrgId(), id, nid)))
    return new Response('Narrative not found', { status: 404 });
  return pdfOfPage(
    `/grants/${encodeURIComponent(id)}/narratives/${encodeURIComponent(nid)}`,
    new URLSearchParams({ print: '1' }),
    `narrative-${nid}.pdf`,
  );
}
