/** Active-item rule shared by the sidebar (server) and the client island that highlights it. */
export const isActiveRoute = (pathname: string, href: string, matches: readonly string[] = []) =>
  href === '/'
    ? pathname === '/'
    : [href, ...matches].some((base) => pathname === base || pathname.startsWith(`${base}/`));
