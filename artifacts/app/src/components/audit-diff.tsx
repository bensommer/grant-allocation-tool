const HIDDEN = new Set(['updatedAt', 'createdAt']);

function fmt(v: unknown): string {
  if (v === null || v === undefined) return '∅';
  if (typeof v === 'object') return JSON.stringify(v);
  return String(v);
}

/** Field-level before/after list for an AuditEvent. */
export function AuditDiff({ before, after }: { before: unknown; after: unknown }) {
  const b = (before ?? {}) as Record<string, unknown>;
  const a = (after ?? {}) as Record<string, unknown>;
  const keys = [...new Set([...Object.keys(b), ...Object.keys(a)])].filter((k) => !HIDDEN.has(k));
  const changed = keys.filter((k) => fmt(b[k]) !== fmt(a[k]));
  if (changed.length === 0) return <span className="muted">no field changes</span>;
  return (
    <ul className="m-0 list-none p-0 text-xs">
      {changed.map((k) => (
        <li key={k}>
          <span className="font-mono">{k}</span>:{' '}
          {before ? <span className="text-red-700 line-through">{fmt(b[k])}</span> : null}{' '}
          {after ? <span className="text-green-800">{fmt(a[k])}</span> : null}
        </li>
      ))}
    </ul>
  );
}
