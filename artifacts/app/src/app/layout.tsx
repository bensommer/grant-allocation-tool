import type { Metadata } from 'next';
import localFont from 'next/font/local';
import { headers } from 'next/headers';
import './globals.css';
import { Nav, navContext } from '@/components/nav';
import { StatusIndicator } from '@/components/status-indicator';
import { prisma } from '@/lib/db';
import { getOrgId } from '@/lib/org';
import { getGlobalStatus } from '@/lib/status';

// Inter is self-hosted (variable weight, latin subset) so production builds
// never depend on fetching Google Fonts.
const inter = localFont({
  src: './fonts/Inter-Variable-latin.woff2',
  weight: '100 900',
  variable: '--font-inter',
  display: 'swap',
});

export const metadata: Metadata = {
  title: 'Grant Allocation Tool',
  description: 'Grant × Program × GL allocation for nonprofit finance teams',
};

export const dynamic = 'force-dynamic';

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const orgId = await getOrgId();
  const [org, status, requestHeaders] = await Promise.all([
    prisma.org.findUniqueOrThrow({ where: { id: orgId } }),
    getGlobalStatus(orgId),
    headers(),
  ]);
  const pathname = requestHeaders.get('x-pathname') ?? '/';
  const returnTo = `${pathname}${requestHeaders.get('x-search') ?? ''}`;
  const context = navContext(pathname);
  return (
    <html lang="en" className={inter.variable}>
      <body>
        <div className="app-shell">
          <Nav orgName={org.name} />
          <div className="app-body">
            <header className="app-header">
              <div className="hidden min-w-0 truncate text-xs text-ink-soft lg:block" data-page-context>
                {context ? (
                  <>
                    <span>{context.group}</span>
                    {context.item !== context.group ? (
                      <>
                        <span aria-hidden="true"> › </span>
                        <span className="font-semibold text-ink">{context.item}</span>
                      </>
                    ) : null}
                  </>
                ) : (
                  <span>{org.name}</span>
                )}
              </div>
              <StatusIndicator status={status} returnTo={returnTo} />
            </header>
            <main className="app-main">{children}</main>
          </div>
        </div>
      </body>
    </html>
  );
}
