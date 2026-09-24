import { getOrgId } from '@/lib/org';
import { bvaData, reportDate } from '@/services/bva';
import { xlsxResponse, xlsxTable } from '@/reports/table-export';
import { restrictedTable } from '@/reports/bva-table';

export async function GET(req: Request) {
  const { date, label } = reportDate(new URL(req.url).searchParams.get('asOf') ?? undefined);
  const { run, grants } = await bvaData(await getOrgId(), date);
  const buf = await xlsxTable(restrictedTable(grants, date, label, run));
  return xlsxResponse(buf, `restricted-${label}.xlsx`);
}
