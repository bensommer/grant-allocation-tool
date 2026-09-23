import Link from 'next/link';
import { PageHeader } from '@/components/page-header';
import { NAV_ITEMS } from '@/components/nav';

export default function DashboardPage() {
  return (
    <>
      <PageHeader
        title="Dashboard"
        subtitle="Grant × Program × GL allocation for nonprofit finance teams."
      />
      <div className="card">
        <ul className="grid grid-cols-2 gap-2 md:grid-cols-4">
          {NAV_ITEMS.filter((i) => i.href !== '/').map((i) => (
            <li key={i.href}>
              <Link href={i.href}>{i.label}</Link>
            </li>
          ))}
        </ul>
      </div>
    </>
  );
}
