import Link from 'next/link';
import { prisma } from '@/lib/db';

export type GrantTab =
  | 'detail'
  | 'funder'
  | 'working'
  | 'activity'
  | 'review'
  | 'rules'
  | 'effort'
  | 'entries'
  | 'periods'
  | 'bva'
  | 'budget'
  | 'history'
  | 'narratives'
  | 'edit';

/**
 * Grant workspace navigation (JPH-23): the working tabs in the order the
 * reviewer uses them, then a quieter row for setup and reference pages.
 * The activity grid only appears for grants that have activities.
 */
export async function GrantTabs({ id, active }: { id: string; active: GrantTab }) {
  const activities = await prisma.grantActivity.count({ where: { grantId: id } });
  const primary = [
    { key: 'detail', href: `/grants/${id}`, label: 'Overview' },
    { key: 'funder', href: `/grants/${id}/funder`, label: 'Funder view' },
    { key: 'working', href: `/grants/${id}/working`, label: 'Working view' },
    ...(activities > 0
      ? [{ key: 'activity', href: `/grants/${id}/activity`, label: 'Activity grid' }]
      : []),
    { key: 'review', href: `/grants/${id}/review`, label: 'Review' },
    { key: 'rules', href: `/grants/${id}/rules`, label: 'Rules' },
    { key: 'effort', href: `/grants/${id}/effort`, label: 'Effort' },
    { key: 'entries', href: `/grants/${id}/entries`, label: 'Entries' },
    { key: 'periods', href: `/grants/${id}/periods`, label: 'Periods' },
  ] as const;
  const secondary = [
    { key: 'bva', href: `/grants/${id}/bva`, label: 'BvA' },
    { key: 'budget', href: `/grants/${id}/budget`, label: 'Budget lines' },
    { key: 'history', href: `/grants/${id}/history`, label: 'History' },
    { key: 'narratives', href: `/grants/${id}/narratives`, label: 'Narratives' },
    { key: 'edit', href: `/grants/${id}/edit`, label: 'Edit' },
  ] as const;
  return (
    <nav className="no-print mb-4" aria-label="Grant workspace">
      <div className="flex max-w-full gap-1 overflow-x-auto border-b border-line">
        {primary.map((t) => (
          <Link
            key={t.key}
            href={t.href}
            aria-current={t.key === active ? 'page' : undefined}
            className={`-mb-px shrink-0 whitespace-nowrap border-b-2 px-3 py-2 text-sm hover:no-underline ${t.key === active ? 'border-harbor font-semibold text-ink' : 'border-transparent text-ink-soft'}`}
          >
            {t.label}
          </Link>
        ))}
      </div>
      <div className="mt-1 flex max-w-full gap-3 overflow-x-auto px-1 text-xs">
        {secondary.map((t) => (
          <Link
            key={t.key}
            href={t.href}
            aria-current={t.key === active ? 'page' : undefined}
            className={`shrink-0 whitespace-nowrap py-1 ${t.key === active ? 'font-semibold text-ink' : 'text-ink-soft'}`}
          >
            {t.label}
          </Link>
        ))}
      </div>
    </nav>
  );
}
