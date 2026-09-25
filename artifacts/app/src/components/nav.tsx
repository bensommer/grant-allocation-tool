import Link from 'next/link';
import { isActiveRoute } from './active-route';
import { NavLink } from './nav-link';

export type NavItem = { href: string; label: string; matches?: readonly string[] };
export type NavGroup = { label: string; items: readonly NavItem[] };

export const NAV_GROUPS: readonly NavGroup[] = [
  { label: 'Overview', items: [{ href: '/', label: 'Dashboard' }] },
  {
    label: 'Grants',
    items: [
      { href: '/grants', label: 'Grants' },
      { href: '/restricted', label: 'Restricted Funds' },
      { href: '/grants/rollforward', label: 'Rollforward' },
      { href: '/narratives', label: 'Narratives' },
    ],
  },
  { label: 'Reports', items: [{ href: '/reports', label: 'Reports', matches: ['/lines'] }] },
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
  { label: 'Settings', items: [{ href: '/settings', label: 'Settings', matches: ['/periods'] }] },
];

export const NAV_ITEMS: readonly NavItem[] = NAV_GROUPS.flatMap((group) => group.items);

/** "Group › Item" for the page the pathname belongs to; used as header context. */
export function navContext(pathname: string): { group: string; item: string } | undefined {
  for (const group of NAV_GROUPS)
    for (const item of group.items)
      if (isActiveRoute(pathname, item.href, item.matches))
        return { group: group.label, item: item.label };
  return undefined;
}

function Brand({ orgName }: { orgName: string }) {
  return (
    <Link href="/" prefetch={false} className="block text-ink no-underline hover:no-underline">
      <span className="block text-sm font-semibold leading-tight">
        <span className="text-harbor">Grant</span> Allocation
      </span>
      <span className="muted block truncate text-xs font-normal">{orgName}</span>
    </Link>
  );
}

function Group({ group, variant }: { group: NavGroup; variant: 'sidebar' | 'menu' }) {
  return (
    <div className={variant === 'sidebar' ? 'mb-4' : 'mb-3'}>
      <div
        className={`text-[10px] font-bold uppercase tracking-wider text-ink-soft ${
          variant === 'sidebar' ? 'mb-1 pl-5' : 'mb-1 px-2'
        }`}
      >
        {group.label}
      </div>
      {group.items.map((item) => (
        <NavLink key={item.href} href={item.href} matches={item.matches} variant={variant}>
          {item.label}
        </NavLink>
      ))}
    </div>
  );
}

export function Nav({ orgName }: { orgName: string }) {
  const settings = NAV_GROUPS[NAV_GROUPS.length - 1]!;
  const main = NAV_GROUPS.slice(0, -1);
  return (
    <>
      <aside className="app-sidebar hidden lg:flex" aria-label="Sidebar">
        <div className="border-b border-line px-5 py-4">
          <Brand orgName={orgName} />
        </div>
        <nav aria-label="Main navigation" className="flex flex-1 flex-col py-4">
          {main.map((group) => (
            <Group key={group.label} group={group} variant="sidebar" />
          ))}
          <div className="mt-auto border-t border-line pt-3">
            <Group group={settings} variant="sidebar" />
          </div>
        </nav>
      </aside>
      <div className="flex items-center justify-between gap-2 border-b border-line bg-white px-4 py-2 lg:hidden">
        <Brand orgName={orgName} />
        <nav aria-label="Main navigation" className="relative">
          <details>
            <summary className="btn btn-secondary btn-sm cursor-pointer list-none">Menu</summary>
            <div className="absolute right-0 z-20 mt-2 max-h-[75vh] w-64 overflow-y-auto rounded-md border border-line bg-white p-3 shadow-card">
              {NAV_GROUPS.map((group) => (
                <Group key={group.label} group={group} variant="menu" />
              ))}
            </div>
          </details>
        </nav>
      </div>
    </>
  );
}
