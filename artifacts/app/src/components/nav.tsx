import { TERMS } from '@/copy/terms';
import Link from 'next/link';
import { NavLink } from './nav-link';

export type NavItem = { href: string; label: string; matches?: readonly string[] };
export type NavGroup = { label: string; items: readonly NavItem[] };

export const NAV_GROUPS: readonly NavGroup[] = [
  { label: 'Overview', items: [{ href: '/', label: TERMS.closeChecklist }] },
  {
    label: 'Grants',
    items: [
      { href: '/grants', label: 'Grants' },
      { href: '/review', label: 'Review' },
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
      { href: '/allocation', label: TERMS.sharedCostSplits },
      { href: '/accounts', label: 'Accounts' },
    ],
  },
  {
    label: 'Data',
    // Import and Runs are reached from the activity log and checklist step 1 (JPH-28 D4).
    items: [{ href: '/activity', label: TERMS.activityLog, matches: ['/import', '/runs'] }],
  },
  { label: 'Settings', items: [{ href: '/settings', label: 'Settings', matches: ['/periods'] }] },
];

export const NAV_ITEMS: readonly NavItem[] = NAV_GROUPS.flatMap((group) => group.items);

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

/** Count badges by href (JPH-27 C5: "Review" carries the transactions waiting across grants). */
export type NavBadges = Readonly<Record<string, number>>;

function Group({
  group,
  variant,
  badges,
}: {
  group: NavGroup;
  variant: 'sidebar' | 'menu';
  badges: NavBadges;
}) {
  return (
    <div className={variant === 'sidebar' ? 'mb-4' : 'mb-3'} data-nav-group={group.label}>
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
          {badges[item.href] ? (
            <span className="tab-count" data-testid="nav-badge" data-href={item.href}>
              {badges[item.href]}
              <span className="sr-only"> transactions to review</span>
            </span>
          ) : null}
        </NavLink>
      ))}
    </div>
  );
}

export function Nav({ orgName, badges = {} }: { orgName: string; badges?: NavBadges }) {
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
            <Group key={group.label} group={group} variant="sidebar" badges={badges} />
          ))}
          <div className="mt-auto border-t border-line pt-3">
            <Group group={settings} variant="sidebar" badges={badges} />
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
                <Group key={group.label} group={group} variant="menu" badges={badges} />
              ))}
            </div>
          </details>
        </nav>
      </div>
    </>
  );
}
