import { redirect } from 'next/navigation';
import { zodErrors } from '@/lib/zod-errors';

export { zodErrors };

/**
 * No-JS-safe form state. Server actions validate; on failure they redirect
 * back to the form with the field errors and the submitted values encoded in
 * the `f` query parameter, so the page re-renders inline errors without any
 * client JavaScript. Successful actions redirect with `?saved=1`.
 */
export interface FormState {
  errors: Record<string, string>;
  values: Record<string, string | string[]>;
}

export function encodeFormState(state: FormState): string {
  return Buffer.from(JSON.stringify(state), 'utf8').toString('base64url');
}

export function decodeFormState(raw: string | undefined): FormState | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8')) as FormState;
    if (parsed && typeof parsed === 'object' && parsed.errors && parsed.values) return parsed;
  } catch {
    // ignore malformed state
  }
  return null;
}

export function redirectWithErrors(
  path: string,
  errors: Record<string, string>,
  formData: FormData,
): never {
  const values: Record<string, string | string[]> = {};
  for (const key of new Set(formData.keys())) {
    if (key.startsWith('$')) continue;
    const all = formData.getAll(key).filter((v): v is string => typeof v === 'string');
    values[key] = all.length > 1 ? all : (all[0] ?? '');
  }
  const sep = path.includes('?') ? '&' : '?';
  redirect(`${path}${sep}f=${encodeFormState({ errors, values })}`);
}

export function str(formData: FormData, name: string): string {
  const v = formData.get(name);
  return typeof v === 'string' ? v.trim() : '';
}

export function strOrNull(formData: FormData, name: string): string | null {
  const s = str(formData, name);
  return s === '' ? null : s;
}

export function list(formData: FormData, name: string): string[] {
  return formData.getAll(name).filter((v): v is string => typeof v === 'string' && v !== '');
}

export function bool(formData: FormData, name: string): boolean {
  const v = formData.get(name);
  return v === 'on' || v === 'true' || v === '1';
}

/** Value to pre-fill an input: submitted value (after a failed post) wins over the stored one. */
export function pick(
  state: FormState | null,
  name: string,
  fallback: string | null | undefined,
): string {
  const v = state?.values[name];
  if (typeof v === 'string') return v;
  if (Array.isArray(v)) return v[0] ?? '';
  return fallback ?? '';
}

export function pickList(state: FormState | null, name: string, fallback: string[]): string[] {
  const v = state?.values[name];
  if (typeof v === 'string') return v === '' ? [] : [v];
  if (Array.isArray(v)) return v;
  return fallback;
}

export function pickBool(state: FormState | null, name: string, fallback: boolean): boolean {
  if (!state) return fallback;
  const v = state.values[name];
  return v === 'on' || v === 'true' || v === '1';
}
