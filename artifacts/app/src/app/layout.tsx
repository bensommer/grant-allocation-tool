import type { Metadata } from 'next';
import localFont from 'next/font/local';
import { headers } from 'next/headers';
import './globals.css';
import { Nav } from '@/components/nav';
import { reviewBadgeCount } from '@/services/grant-figures';
import { Breadcrumbs } from '@/components/ui/breadcrumbs';
import { breadcrumbsFor } from '@/lib/breadcrumbs';
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
  const [org, status, requestHeaders, toReview] = await Promise.all([
    prisma.org.findUniqueOrThrow({ where: { id: orgId } }),
    getGlobalStatus(orgId),
    headers(),
    reviewBadgeCount(orgId),
  ]);
  const pathname = requestHeaders.get('x-pathname') ?? '/';
  const trail = await breadcrumbsFor(orgId, pathname);
  return (
    <html lang="en" className={inter.variable}>
      <body>
        <div className="app-shell">
          <Nav orgName={org.name} badges={{ '/review': toReview }} />
          <div className="app-body">
            <header className="app-header">
              <Breadcrumbs trail={trail} fallback={org.name} />
              <StatusIndicator status={status} />
            </header>
            <main className="app-main">{children}</main>
          </div>
        </div>
      </body>
    </html>
  );
}
