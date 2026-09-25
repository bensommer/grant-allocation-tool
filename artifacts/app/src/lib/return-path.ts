/**
 * Only a same-origin path survives: parse against a fixed origin and keep the normalized pathname
 * and search, so `//host`, `/\\host`, schemes and control characters all fall back to /runs.
 */
export function safeReturnPath(candidate: string, fallback = '/runs'): string {
  if (!candidate.startsWith('/') || /[\\\s\u0000-\u001f]/.test(candidate)) return fallback;
  try {
    const url = new URL(candidate, 'http://returnto.invalid');
    if (url.origin !== 'http://returnto.invalid') return fallback;
    return `${url.pathname}${url.search}`;
  } catch {
    return fallback;
  }
}
