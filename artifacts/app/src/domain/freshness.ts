/**
 * Header chip copy (JPH-28 D3). Pure so the wording is unit-testable:
 * "Updated just now" (< 60 s), "Updated 5 min ago", "Updated 3 h ago", "Updated Sep 25",
 * "Updating…", "Update failed — see activity log".
 */
import { formatDate } from '@/domain/format';
import type { FreshnessState } from '@/lib/status';

export function freshnessLabel(
  state: FreshnessState,
  updatedAt: Date | null,
  ageMs: number | null,
): string {
  if (state === 'updating') return 'Updating…';
  if (state === 'failed') return 'Update failed — see activity log';
  if (state === 'none' || !updatedAt || ageMs === null) return 'Not calculated yet';
  const prefix = state === 'needs_update' ? 'Needs update · last updated' : 'Updated';
  return `${prefix} ${relativeAge(updatedAt, ageMs)}`;
}

export function relativeAge(updatedAt: Date, ageMs: number): string {
  const seconds = Math.floor(ageMs / 1000);
  if (seconds < 60) return 'just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  return formatDate(updatedAt);
}
