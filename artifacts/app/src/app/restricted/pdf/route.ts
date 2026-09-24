import { pdfOfPage } from '@/reports/table-export';

export async function GET(req: Request) {
  const asOf = new URL(req.url).searchParams.get('asOf');
  const q = new URLSearchParams(asOf ? { asOf } : {});
  return pdfOfPage('/restricted', q, `restricted-${asOf ?? 'today'}.pdf`);
}
