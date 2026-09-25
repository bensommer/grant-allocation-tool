import { NextResponse, type NextRequest } from 'next/server';

/**
 * Exposes the request path to the root layout (server components cannot read it otherwise) so
 * the header can show page context and the inline Recompute button can return to the same page.
 */
export function proxy(request: NextRequest) {
  const headers = new Headers(request.headers);
  headers.set('x-pathname', request.nextUrl.pathname);
  headers.set('x-search', request.nextUrl.search);
  return NextResponse.next({ request: { headers } });
}

export const config = {
  matcher: ['/((?!_next/|favicon\\.ico|.*\\.(?:png|jpg|svg|woff2?|ico)$).*)'],
};
