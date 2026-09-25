import { getOrgId } from '@/lib/org';
import { funderViewXlsx } from '@/reports/funder-view';
import { xlsxResponse } from '@/reports/table-export';
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
  const buf = await funderViewXlsx(grant, await budgetTree(orgId, id, date), date);
  return xlsxResponse(buf, `funder-view-${label}.xlsx`);
}
