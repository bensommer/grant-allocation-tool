/**
 * A 302 to a same-origin path. Relative `Location` headers keep the redirect on whatever host
 * the browser used (the dev proxy, localhost, the published domain) instead of the bind address
 * the server sees in `req.url`.
 */
export function redirectTo(path: string, status: 302 | 303 = 302): Response {
  return new Response(null, { status, headers: { Location: path } });
}
