import { getOrgId } from '@/lib/org';
import { funderCategoriesTable } from '@/reports/funder-view';
import { pdfDocument, pdfErrorResponse, pdfResponse } from '@/reports/pdf';
import { defaultReportDate } from '@/services/bva';
import { budgetTree } from '@/services/grant-budget';
import { grantHeader } from '@/services/grant-workspace';

export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const orgId = await getOrgId();
  const grant = await grantHeader(orgId, id);
  if (!grant) return new Response('Not found', { status: 404 });
  const { date, label } = await defaultReportDate(
    orgId,
    new URL(req.url).searchParams.get('asOf') ?? undefined,
  );
  const table = funderCategoriesTable(grant, await budgetTree(orgId, id, date), date);
  try {
    const buf = await pdfDocument({
      title: table.title,
      subtitle: `${grant.funder} · as of ${label}`,
      parameters: table.parameters,
      sections: [{ table }],
      portrait: true,
    });
    return pdfResponse(buf, `funder-view-${label}.pdf`);
  } catch (error) {
    return pdfErrorResponse(error);
  }
}
