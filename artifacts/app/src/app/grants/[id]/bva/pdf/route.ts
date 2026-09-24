import { getOrgId } from '@/lib/org';
import { bvaData, reportDate } from '@/services/bva';
import { grantBvaTable } from '@/reports/bva-table';
import { pdfDocument, pdfErrorResponse, pdfResponse } from '@/reports/pdf';

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { date, label } = reportDate(new URL(req.url).searchParams.get('asOf') ?? undefined);
  const { run, grants } = await bvaData(await getOrgId(), date, id);
  const grant = grants[0];
  if (!grant) return new Response('Grant not found', { status: 404 });
  const table = grantBvaTable(grant, date, label, run);
  try {
    const buf = await pdfDocument({
      title: table.title,
      parameters: table.parameters,
      sections: [{ table }],
    });
    return pdfResponse(buf, `bva-${label}.pdf`);
  } catch (error) {
    return pdfErrorResponse(error);
  }
}
