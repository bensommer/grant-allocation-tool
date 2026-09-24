import { pdfOfPage } from '@/reports/table-export';

export async function GET(req: Request) {
  const asOf = new URL(req.url).searchParams.get('asOf');
  return pdfOfPage(req, '/restricted', `restricted-${asOf ?? 'today'}.pdf`, asOf ? { asOf } : {});
}
