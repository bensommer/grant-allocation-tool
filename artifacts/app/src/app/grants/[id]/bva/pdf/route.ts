import { pdfOfPage } from '@/reports/table-export';

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const asOf = new URL(req.url).searchParams.get('asOf');
  return pdfOfPage(req, `/grants/${id}/bva`, `bva-${asOf ?? 'today'}.pdf`, asOf ? { asOf } : {});
}
