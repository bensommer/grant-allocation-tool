import Link from 'next/link';
import type { Crumb } from '@/lib/breadcrumbs';

/** Full trail rendered once by the root layout (JPH-25 A4); the last crumb is the current page. */
export function Breadcrumbs({ trail, fallback }: { trail: Crumb[]; fallback: string }) {
  if (!trail.length)
    return (
      <div className="hidden min-w-0 truncate text-xs text-ink-soft lg:block" data-page-context>
        <span>{fallback}</span>
      </div>
    );
  return (
    <nav
      aria-label="Breadcrumb"
      className="hidden min-w-0 truncate text-xs text-ink-soft lg:block"
      data-page-context
    >
      <ol className="m-0 inline list-none p-0">
        {trail.map((crumb, i) => {
          const last = i === trail.length - 1;
          return (
            <li key={`${crumb.label}-${i}`} className="inline" data-crumb>
              {i > 0 ? <span aria-hidden="true"> › </span> : null}
              {last ? (
                <span className="font-semibold text-ink" aria-current="page">
                  {crumb.label}
                </span>
              ) : crumb.href ? (
                <Link href={crumb.href} prefetch={false} className="text-ink-soft">
                  {crumb.label}
                </Link>
              ) : (
                <span>{crumb.label}</span>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
