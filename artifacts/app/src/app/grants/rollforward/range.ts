import { parseDateInput } from '@/domain/dates';
import { prisma } from '@/lib/db';
import { defaultRollforwardRange } from '@/services/grant-periods';

/** Parse ?from&to, defaulting to the org's current fiscal year through today. */
export async function resolveRange(orgId: string, from?: string, to?: string) {
  const org = await prisma.org.findFirstOrThrow({
    where: { id: orgId },
    select: { fiscalYearStartMonth: true },
  });
  const d = defaultRollforwardRange(org.fiscalYearStartMonth);
  let error: string | null = null;
  let f = d.from;
  let t = d.to;
  try {
    if (from) f = parseDateInput(from);
    if (to) t = parseDateInput(to);
  } catch {
    error = 'Enter dates as YYYY-MM-DD.';
  }
  if (f > t) error = 'From must not be after To.';
  return { from: f, to: t, error };
}

