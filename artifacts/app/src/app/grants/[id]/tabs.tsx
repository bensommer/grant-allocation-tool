import Link from 'next/link';
import { prisma } from '@/lib/db';
import { getOrgId } from '@/lib/org';
import { needsReviewCount } from '@/services/grant-workspace';

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

type Tab = { key: GrantTab; href: string; label: string; count?: number };

/**
 * Grant workspace navigation (JPH-23). The working tabs sit in three groups —
 * Report (what goes out), Work (what needs doing), Close (periods) — with a quieter
 * row for setup and reference pages. The activity grid only appears for grants that
 * have activities; the Review tab carries the count of lines waiting.
 */
export async function GrantTabs({ id, active }: { id: string; active: GrantTab }) {
  const orgId = await getOrgId();
  const [activities, waiting] = await Promise.all([
    prisma.grantActivity.count({ where: { grantId: id } }),
    needsReviewCount(orgId, id),
  ]);
  const base = `/grants/${id}`;
  const groups: Array<{ label: string; tabs: Tab[] }> = [
    {
      label: 'Report',
      tabs: [
        { key: 'detail', href: base, label: 'Overview' },
        { key: 'funder', href: `${base}/funder`, label: 'Funder view' },
        { key: 'working', href: `${base}/working`, label: 'Working view' },
        ...(activities > 0
          ? [{ key: 'activity', href: `${base}/activity`, label: 'Activity grid' } as Tab]
          : []),
      ],
    },
    {
      label: 'Work',
      tabs: [
        { key: 'review', href: `${base}/review`, label: 'Review', count: waiting },
        { key: 'rules', href: `${base}/rules`, label: 'Rules' },
        { key: 'effort', href: `${base}/effort`, label: 'Effort' },
        { key: 'entries', href: `${base}/entries`, label: 'Entries' },
      ],
    },
    { label: 'Close', tabs: [{ key: 'periods', href: `${base}/periods`, label: 'Periods' }] },
  ];
  const secondary: Tab[] = [
    { key: 'bva', href: `${base}/bva`, label: 'BvA' },
    { key: 'budget', href: `${base}/budget`, label: 'Budget lines' },
    { key: 'history', href: `${base}/history`, label: 'History' },
    { key: 'narratives', href: `${base}/narratives`, label: 'Narratives' },
    { key: 'edit', href: `${base}/edit`, label: 'Edit' },
  ];
  return (
    <nav className="no-print mb-4" aria-label="Grant workspace">
      <div className="tab-groups">
        {groups.map((g) => (
          <div key={g.label} className="tab-group">
            <span className="tab-group-label" aria-hidden="true">
              {g.label}
            </span>
            <div className="tab-group-links">
              {g.tabs.map((t) => (
                <Link
                  key={t.key}
                  href={t.href}
                  aria-current={t.key === active ? 'page' : undefined}
                  className={`-mb-px shrink-0 whitespace-nowrap border-b-2 px-3 py-2 text-sm hover:no-underline ${t.key === active ? 'border-harbor font-semibold text-ink' : 'border-transparent text-ink-soft'}`}
                >
                  {t.label}
                  {t.count ? (
                    <span className="tab-count" data-testid="review-tab-count">
                      {t.count}
                      <span className="sr-only"> lines waiting for review</span>
                    </span>
                  ) : null}
                </Link>
              ))}
            </div>
          </div>
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
