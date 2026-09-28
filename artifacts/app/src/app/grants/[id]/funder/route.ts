import { redirectTo } from '@/lib/redirect-response';

/** JPH-29 E2: the Funder view lives on the one Budget vs. Actuals page; 302 there, keeping the query. */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const q = new URL(req.url).searchParams;
  q.set('view', 'funder');
  return redirectTo(`/grants/${id}/bva?${q}`);
}
