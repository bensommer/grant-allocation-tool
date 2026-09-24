import { getOrgId } from '@/lib/org';
import { bvaData, reportDate } from '@/services/bva';
import { restrictedTable } from '@/reports/bva-table';
import { pdfDocument, pdfErrorResponse, pdfResponse } from '@/reports/pdf';

export async function GET(req: Request) {
  const { date, label } = reportDate(new URL(req.url).searchParams.get('asOf') ?? undefined);
  const { run, grants } = await bvaData(await getOrgId(), date);
  const table = restrictedTable(grants, date, label, run);
  try {
    const buf = await pdfDocument({
      title: table.title,
      parameters: table.parameters,
      sections: [{ table }],
    });
    return pdfResponse(buf, `restricted-${label}.pdf`);
  } catch (error) {
    return pdfErrorResponse(error);
  }
}
