import { pdfDocument, pdfErrorResponse, pdfResponse } from '@/reports/pdf';
import { loadBvaExport } from '../export';

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const data = await loadBvaExport(req, id);
  if (!data) return new Response('Grant not found', { status: 404 });
  const { table } = data;
  try {
    const buf = await pdfDocument({
      title: table.title,
      subtitle: `${data.grant.funder} · as of ${data.label}`,
      parameters: table.parameters,
      sections: [{ table }],
      portrait: data.view === 'funder',
    });
    return pdfResponse(buf, data.filename('pdf'));
  } catch (error) {
    return pdfErrorResponse(error);
  }
}
