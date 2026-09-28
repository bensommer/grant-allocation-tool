import { toISODate } from '@/domain/dates';
import type { DateRange } from '@/domain/period';

/** Preset report shapes; the date range is the app default (JPH-25 A1), never hard-coded. */
export const PRESET_SHAPES = [
  { title: 'Program × GL', shape: 'rows=program&cols=glAccount' },
  { title: 'Grant budget line × GL', shape: 'rows=grantBudgetLine&cols=glAccount&page=grant' },
  { title: 'Grant × Program', shape: 'rows=grant&cols=program' },
  { title: 'Monthly trend by grant', shape: 'rows=month&cols=grantBudgetLine' },
] as const;

export function presets(range: DateRange) {
  const period = `from=${toISODate(range.from)}&to=${toISODate(range.to)}`;
  return PRESET_SHAPES.map((p) => ({ title: p.title, query: `${p.shape}&${period}` }));
}
