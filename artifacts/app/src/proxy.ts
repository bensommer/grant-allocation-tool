import { NextResponse, type NextRequest } from 'next/server';
import { AS_OF_COOKIE, parseISODateOrNull } from '@/domain/period';

/**
 * Exposes the request path to the root layout (server components cannot read it otherwise) so
 * the header can show page context and the inline Recompute button can return to the same page.
 * Applying an as-of on any page (`?asOf=`) also remembers it in the `gat_asof` cookie, so
 * every other page defaults to the same date (JPH-25 A1). Server components cannot set
 * cookies, and the as-of forms are plain GETs, so the proxy is the one place that can.
 */
export function proxy(request: NextRequest) {
  const headers = new Headers(request.headers);
  headers.set('x-pathname', request.nextUrl.pathname);
  headers.set('x-search', request.nextUrl.search);
  const response = NextResponse.next({ request: { headers } });
  const asOf = request.nextUrl.searchParams.get('asOf');
  if (asOf && parseISODateOrNull(asOf))
    response.cookies.set(AS_OF_COOKIE, asOf, {
      path: '/',
      sameSite: 'lax',
      maxAge: 60 * 60 * 24 * 30,
    });
  return response;
}

export const config = {
  matcher: ['/((?!_next/|favicon\\.ico|.*\\.(?:png|jpg|svg|woff2?|ico)$).*)'],
};
