import type { Metadata } from 'next';
import './globals.css';
import { Nav } from '@/components/nav';
import { prisma } from '@/lib/db';
import { getOrgId } from '@/lib/org';

export const metadata: Metadata = {
  title: 'Grant Allocation Tool',
  description: 'Grant × Program × GL allocation for nonprofit finance teams',
};

export const dynamic = 'force-dynamic';

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const orgId = await getOrgId();
  const org = await prisma.org.findUniqueOrThrow({ where: { id: orgId } });
  return (
    <html lang="en">
      <body>
        <Nav orgName={org.name} />
        <main className="mx-auto max-w-7xl px-4 py-6">{children}</main>
      </body>
    </html>
  );
}
