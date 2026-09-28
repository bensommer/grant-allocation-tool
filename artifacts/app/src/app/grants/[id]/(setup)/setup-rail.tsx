import Link from 'next/link';

export const SETUP_SECTIONS = [
  { key: 'details', label: 'Grant details', path: '/edit' },
  { key: 'tracking', label: 'How QuickBooks tracks it', path: '/edit#tracking' },
  { key: 'budget', label: 'Budget', path: '/budget' },
  { key: 'rules', label: 'Rules', path: '/rules' },
  { key: 'activities', label: 'Activities', path: '/activity' },
  { key: 'periods', label: 'Periods & reported prior years', path: '/periods' },
  { key: 'history', label: 'History', path: '/history' },
  { key: 'narratives', label: 'Narratives', path: '/narratives' },
] as const;

export type SetupSectionKey = (typeof SETUP_SECTIONS)[number]['key'];

/** Which rail entry a setup pathname belongs to (`/grants/<id>/rules/new` → rules). */
export function setupSectionFor(pathname: string): SetupSectionKey {
  const rest = pathname.replace(/^\/grants\/[^/]+/, '');
  if (rest.startsWith('/budget')) return 'budget';
  if (rest.startsWith('/activity')) return 'activities';
  if (rest.startsWith('/rules')) return 'rules';
  if (rest.startsWith('/periods')) return 'periods';
  if (rest.startsWith('/history')) return 'history';
  if (rest.startsWith('/narratives')) return 'narratives';
  return 'details';
}

/**
 * Setup tab navigation (JPH-29 E1): a left rail on desktop, a select with a Go button on
 * mobile (works without JavaScript).
 */
export function SetupRail({ id, current }: { id: string; current: SetupSectionKey }) {
  const base = `/grants/${id}`;
  return (
    <>
      <nav
        className="no-print hidden md:block"
        aria-label="Setup sections"
        data-testid="setup-rail"
      >
        <ul className="sticky top-4 m-0 list-none space-y-1 p-0 text-sm">
          {SETUP_SECTIONS.map((s) => (
            <li key={s.key}>
              <Link
                href={`${base}${s.path}`}
                aria-current={s.key === current ? 'page' : undefined}
                className={`block rounded px-2 py-1 hover:no-underline ${s.key === current ? 'bg-harbor/10 font-semibold text-ink' : 'text-ink-soft'}`}
              >
                {s.label}
              </Link>
            </li>
          ))}
        </ul>
      </nav>
      <form
        method="get"
        action={`${base}/setup`}
        className="no-print mb-3 flex items-end gap-2 md:hidden"
        aria-label="Setup sections"
        data-testid="setup-select"
      >
        <label className="grow">
          <span className="block text-xs text-ink-soft">Setup section</span>
          <select name="section" defaultValue={current} className="w-full">
            {SETUP_SECTIONS.map((s) => (
              <option key={s.key} value={s.key}>
                {s.label}
              </option>
            ))}
          </select>
        </label>
        <button type="submit" className="btn btn-secondary btn-sm">
          Go
        </button>
      </form>
    </>
  );
}
