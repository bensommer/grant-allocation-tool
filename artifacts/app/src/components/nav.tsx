import Link from 'next/link';

export const NAV_ITEMS: ReadonlyArray<{ href: string; label: string }> = [
  { href: '/', label: 'Dashboard' },
  { href: '/import', label: 'Import' },
  { href: '/accounts', label: 'Accounts' },
  { href: '/grants', label: 'Grants' },
  { href: '/programs', label: 'Programs' },
  { href: '/crosswalk', label: 'Crosswalk' },
  { href: '/allocation', label: 'Allocation Rules' },
  { href: '/runs', label: 'Runs' },
  { href: '/reports', label: 'Reports' },
  { href: '/restricted', label: 'Restricted Funds' },
  { href: '/narratives', label: 'Narratives' },
  { href: '/settings', label: 'Settings' },
];

/** Server-rendered navigation. Plain links; no client JS required. */
export function Nav({ orgName }: { orgName: string }) {
  return (
    <nav className="border-b border-line bg-white">
      <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-x-1 px-4 py-2">
        <Link href="/" className="mr-4 font-semibold text-ink no-underline hover:no-underline">
          <span className="text-harbor">Grant</span> Allocation
          <span className="muted ml-2 text-xs font-normal">{orgName}</span>
        </Link>
        {NAV_ITEMS.map((item) => (
          <Link
            key={item.href}
            href={item.href}
            className="rounded px-2 py-1 text-sm text-ink-soft hover:bg-paper-2 hover:no-underline"
          >
            {item.label}
          </Link>
        ))}
      </div>
    </nav>
  );
}
