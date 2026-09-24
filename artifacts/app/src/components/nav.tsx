import Link from 'next/link';
import { NavLink } from './nav-link';

export const NAV_GROUPS = [
  { label: 'Overview', items: [{ href: '/', label: 'Dashboard' }] },
  {
    label: 'Grants',
    items: [
      { href: '/grants', label: 'Grants' },
      { href: '/restricted', label: 'Restricted Funds' },
      { href: '/narratives', label: 'Narratives' },
    ],
  },
  { label: 'Reports', items: [{ href: '/reports', label: 'Reports' }] },
  {
    label: 'Setup',
    items: [
      { href: '/programs', label: 'Programs' },
      { href: '/crosswalk', label: 'Crosswalk' },
      { href: '/allocation', label: 'Allocation Rules' },
      { href: '/accounts', label: 'Accounts' },
    ],
  },
  {
    label: 'Data',
    items: [
      { href: '/import', label: 'Import' },
      { href: '/runs', label: 'Runs' },
    ],
  },
  { label: 'Settings', items: [{ href: '/settings', label: 'Settings' }] },
] as const;

export const NAV_ITEMS: ReadonlyArray<{ href: string; label: string }> = NAV_GROUPS.flatMap(
  (group) => [...group.items] as { href: string; label: string }[],
);

export function Nav({ orgName }: { orgName: string }) {
  return (
    <nav aria-label="Main navigation" className="border-b border-line bg-white">
      <div className="mx-auto flex max-w-[1600px] items-center justify-between gap-2 px-3 py-2">
        <Link
          href="/"
          prefetch={false}
          className="shrink-0 text-xs font-semibold text-ink no-underline hover:no-underline"
        >
          <span className="text-harbor">Grant</span> Allocation{' '}
          <span className="muted hidden font-normal 2xl:inline">{orgName}</span>
        </Link>
        <div className="hidden items-center gap-1.5 lg:flex">
          {NAV_GROUPS.map((group) => (
            <div key={group.label} className="flex items-center gap-0.5 whitespace-nowrap">
              <span className="text-[9px] font-bold uppercase tracking-wide text-ink-soft">
                {group.label}
              </span>
              {group.items.map((item) => (
                <NavLink key={item.href} href={item.href}>
                  {item.label}
                </NavLink>
              ))}
            </div>
          ))}
        </div>
        <details className="relative lg:hidden">
          <summary className="btn btn-secondary cursor-pointer list-none">Menu</summary>
          <div className="absolute right-0 z-20 mt-2 max-h-[75vh] w-64 overflow-y-auto rounded-md border border-line bg-white p-3 shadow-card">
            {NAV_GROUPS.map((group) => (
              <div key={group.label} className="mb-3">
                <div className="mb-1 text-xs font-bold uppercase text-ink-soft">{group.label}</div>
                {group.items.map((item) => (
                  <NavLink key={item.href} href={item.href} mobile>
                    {item.label}
                  </NavLink>
                ))}
              </div>
            ))}
          </div>
        </details>
      </div>
    </nav>
  );
}
