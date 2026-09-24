import type { Metadata } from 'next';
import localFont from 'next/font/local';
import Link from 'next/link';
import './globals.css';
import { Nav } from '@/components/nav';
import { StatusPill } from '@/components/ui';
import { formatDate, formatDateTime } from '@/domain/format';
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
  const org = await prisma.org.findUniqueOrThrow({ where: { id: orgId } });
  const status = await getGlobalStatus(orgId);
  return (
    <html lang="en" className={inter.variable}>
      <body>
        <Nav orgName={org.name} />
        <div className="border-b border-line bg-paper-2 px-4 py-2 text-xs text-ink-soft">
          <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-x-2 gap-y-1">
            <span>
              Books through{' '}
              {status.booksThrough ? formatDate(status.booksThrough) : 'no imported transactions'}
            </span>
            <span aria-hidden="true">·</span>
            <span data-volatile>
              Current run{' '}
              {status.currentRun
                ? formatDateTime(status.currentRun.finishedAt ?? status.currentRun.startedAt)
                : 'none'}
            </span>
            {status.currentRun?.stale ? (
              <>
                <span aria-hidden="true">·</span>
                <Link href="/runs" prefetch={false}>
                  <StatusPill tone="warn">Recompute needed</StatusPill>
                </Link>
              </>
            ) : null}
          </div>
        </div>
        <main className="mx-auto max-w-7xl px-4 py-6">{children}</main>
      </body>
    </html>
  );
}
