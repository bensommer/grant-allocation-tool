import { redirectTo } from '@/lib/redirect-response';
import { SETUP_SECTIONS } from '../(setup)/setup-rail';

/** Target of the mobile setup select (no-JS): `?section=rules` → `/grants/<id>/rules`. */
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const wanted = new URL(req.url).searchParams.get('section');
  const section = SETUP_SECTIONS.find((s) => s.key === wanted) ?? SETUP_SECTIONS[0];
  return redirectTo(`/grants/${id}${section.path}`);
}
