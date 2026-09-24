import { getOrgId } from '@/lib/org';
import { bvaData, reportDate } from '@/services/bva';
import { grantBvaTable } from '@/reports/bva-table';
import { xlsxResponse, xlsxTable } from '@/reports/table-export';

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { date, label } = reportDate(new URL(req.url).searchParams.get('asOf') ?? undefined);
  const { run, grants } = await bvaData(await getOrgId(), date, id);
  const grant = grants[0];
  if (!grant) return new Response('Grant not found', { status: 404 });
  const buf = await xlsxTable(grantBvaTable(grant, date, label, run));
  return xlsxResponse(buf, `bva-${grant.awardNumber ?? grant.name}-${label}.xlsx`);
}
