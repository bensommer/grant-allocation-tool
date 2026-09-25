import Link from 'next/link';

export function GrantTabs({
  id,
  active,
}: {
  id: string;
  active: 'detail' | 'bva' | 'budget' | 'review' | 'rules' | 'history' | 'narratives' | 'edit';
}) {
  const tabs = [
    { key: 'detail', href: `/grants/${id}`, label: 'Overview' },
    { key: 'bva', href: `/grants/${id}/bva`, label: 'BvA' },
    { key: 'budget', href: `/grants/${id}/budget`, label: 'Budget lines' },
    { key: 'review', href: `/grants/${id}/review`, label: 'Review' },
    { key: 'rules', href: `/grants/${id}/rules`, label: 'Rules' },
    { key: 'history', href: `/grants/${id}/history`, label: 'History' },
    { key: 'narratives', href: `/grants/${id}/narratives`, label: 'Narratives' },
    { key: 'edit', href: `/grants/${id}/edit`, label: 'Edit' },
  ] as const;
  return (
    <div className="no-print mb-4 flex max-w-full gap-1 overflow-x-auto border-b border-line">
      {tabs.map((t) => (
        <Link
          key={t.key}
          href={t.href}
          className={`-mb-px shrink-0 whitespace-nowrap border-b-2 px-3 py-2 text-sm hover:no-underline ${t.key === active ? 'border-harbor font-semibold text-ink' : 'border-transparent text-ink-soft'}`}
        >
          {t.label}
        </Link>
      ))}
    </div>
  );
}
