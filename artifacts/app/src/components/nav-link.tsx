'use client';
// Tiny client island solely for active-route indication; links SSR and work with JS disabled.
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';
import { isActiveRoute } from './active-route';

const styles = {
  sidebar:
    'block border-l-[3px] border-transparent py-1.5 pl-[17px] pr-3 text-[13px] text-ink hover:bg-paper-2 hover:no-underline aria-[current=page]:border-harbor aria-[current=page]:bg-harbor-soft aria-[current=page]:font-semibold aria-[current=page]:text-harbor',
  menu: 'block rounded px-2 py-1.5 text-sm text-ink hover:bg-paper-2 hover:no-underline aria-[current=page]:bg-harbor-soft aria-[current=page]:font-semibold aria-[current=page]:text-harbor',
};

export function NavLink({
  href,
  matches,
  children,
  variant = 'sidebar',
}: {
  href: string;
  /** Extra path prefixes (nested routes reached from this item) that keep it highlighted. */
  matches?: readonly string[];
  children: ReactNode;
  variant?: keyof typeof styles;
}) {
  const pathname = usePathname();
  const active = isActiveRoute(pathname, href, matches);
  return (
    <Link
      href={href}
      prefetch={false}
      aria-current={active ? 'page' : undefined}
      className={styles[variant]}
    >
      {children}
    </Link>
  );
}
