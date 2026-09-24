'use client';
// Tiny client island solely for active-route indication; links SSR and work with JS disabled.
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';

export function NavLink({
  href,
  children,
  mobile = false,
}: {
  href: string;
  children: ReactNode;
  mobile?: boolean;
}) {
  const pathname = usePathname();
  const active =
    href === '/' ? pathname === '/' : pathname === href || pathname.startsWith(`${href}/`);
  return (
    <Link
      href={href}
      prefetch={false}
      aria-current={active ? 'page' : undefined}
      className={`${mobile ? 'block' : ''} rounded px-1 py-1 text-[11px] text-ink hover:bg-paper-2 hover:no-underline aria-[current=page]:bg-harbor-soft aria-[current=page]:font-bold aria-[current=page]:text-harbor`}
    >
      {children}
    </Link>
  );
}
