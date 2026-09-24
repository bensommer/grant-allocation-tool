import { pdfOfPage } from '@/reports/table-export';

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const asOf = new URL(req.url).searchParams.get('asOf');
  const q = new URLSearchParams(asOf ? { asOf } : {});
  return pdfOfPage(`/grants/${id}/bva`, q, `bva-${asOf ?? 'today'}.pdf`);
}
