import type { FormState } from '@/lib/forms';

/** Inline field error, rendered server-side. */
export function FieldError({ state, name }: { state: FormState | null; name: string }) {
  const msg = state?.errors[name];
  return msg ? <p className="field-error">{msg}</p> : null;
}

export function FormBanner({ state, saved }: { state: FormState | null; saved?: boolean }) {
  if (state && Object.keys(state.errors).length > 0) {
    const general = state.errors['_'];
    return (
      <div className="banner banner-bad" role="alert">
        {general ?? 'Please fix the highlighted fields.'}
      </div>
    );
  }
  if (saved) return <div className="banner banner-ok">Saved.</div>;
  return null;
}

export function Field({
  label,
  name,
  error,
  hint,
  children,
  className,
}: {
  label: string;
  name: string;
  error?: string;
  hint?: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={className}>
      <label htmlFor={name}>{label}</label>
      {children}
      {hint ? <p className="muted mt-0.5 text-xs">{hint}</p> : null}
      {error ? <p className="field-error">{error}</p> : null}
    </div>
  );
}

/**
 * Multi-select rendered as checkboxes: works without JS, and accountants can
 * see every option at once. Names repeat so FormData.getAll(name) yields the list.
 */
export function CheckboxList({
  name,
  options,
  selected,
  disabledNote,
}: {
  name: string;
  options: Array<{ value: string; label: string; note?: string }>;
  selected: string[];
  disabledNote?: (value: string) => string | null;
}) {
  if (options.length === 0) return <p className="muted text-xs">No options available.</p>;
  return (
    <div className="flex flex-col gap-1 rounded border border-line bg-white p-2">
      {options.map((o) => {
        const note = disabledNote?.(o.value) ?? o.note;
        return (
          <label
            key={o.value}
            className="flex items-center gap-2 text-sm font-normal normal-case text-ink"
          >
            <input
              type="checkbox"
              name={name}
              value={o.value}
              defaultChecked={selected.includes(o.value)}
            />
            <span>{o.label}</span>
            {note ? <span className="muted text-xs">— {note}</span> : null}
          </label>
        );
      })}
    </div>
  );
}
