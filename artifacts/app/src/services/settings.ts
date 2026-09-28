import { prisma } from '@/lib/db';

export function pacingSettings(json: unknown) {
  const obj =
    json && typeof json === 'object' && !Array.isArray(json)
      ? (json as Record<string, unknown>)
      : {};
  const underPercent = typeof obj.pacingUnderPercent === 'number' ? obj.pacingUnderPercent : 15;
  const overPercent = typeof obj.pacingOverPercent === 'number' ? obj.pacingOverPercent : 10;
  return { underPercent, overPercent };
}

export async function getPacingSettings(orgId: string) {
  const org = await prisma.org.findUniqueOrThrow({ where: { id: orgId } });
  return pacingSettings(org.settings);
}

/** Fiscal year start month (1–12); every default date range starts here (JPH-25 A1). */
export async function getFiscalYearStartMonth(orgId: string): Promise<number> {
  const org = await prisma.org.findUniqueOrThrow({
    where: { id: orgId },
    select: { fiscalYearStartMonth: true },
  });
  return org.fiscalYearStartMonth;
}

export async function saveFiscalYearStartMonth(orgId: string, month: number): Promise<void> {
  if (!Number.isInteger(month) || month < 1 || month > 12)
    throw new Error('Fiscal year start month must be 1–12');
  await prisma.org.update({ where: { id: orgId }, data: { fiscalYearStartMonth: month } });
}

export async function savePacingSettings(orgId: string, underPercent: number, overPercent: number) {
  if (![underPercent, overPercent].every((n) => Number.isFinite(n) && n >= 0 && n <= 100))
    throw new Error('Thresholds must be between 0 and 100');
  const org = await prisma.org.findUniqueOrThrow({ where: { id: orgId } });
  const original =
    org.settings && typeof org.settings === 'object' && !Array.isArray(org.settings)
      ? org.settings
      : {};
  await prisma.org.update({
    where: { id: orgId },
    data: {
      settings: { ...original, pacingUnderPercent: underPercent, pacingOverPercent: overPercent },
    },
  });
}

/**
 * Default destination for correcting entries (JPH-22): the class and/or the
 * project (customer party) that reclassed or trued-up amounts move to. Unset
 * (both null) blocks drafting.
 */
export interface DefaultDestination {
  classId: string | null;
  partyId: string | null;
}

export function defaultDestination(json: unknown): DefaultDestination {
  const obj =
    json && typeof json === 'object' && !Array.isArray(json)
      ? (json as Record<string, unknown>)
      : {};
  const classId = typeof obj.defaultDestinationClassId === 'string' ? obj.defaultDestinationClassId : null;
  const partyId = typeof obj.defaultDestinationPartyId === 'string' ? obj.defaultDestinationPartyId : null;
  return { classId: classId || null, partyId: partyId || null };
}

export function isDestinationSet(d: DefaultDestination): boolean {
  return d.classId !== null || d.partyId !== null;
}

export async function getDefaultDestination(orgId: string): Promise<DefaultDestination> {
  const org = await prisma.org.findUniqueOrThrow({ where: { id: orgId } });
  return defaultDestination(org.settings);
}

export async function saveDefaultDestination(orgId: string, d: DefaultDestination): Promise<void> {
  if (d.classId) {
    const cls = await prisma.trackingClass.findFirst({ where: { id: d.classId, orgId } });
    if (!cls) throw new Error('Class not found');
  }
  if (d.partyId) {
    const party = await prisma.party.findFirst({ where: { id: d.partyId, orgId } });
    if (!party) throw new Error('Project / customer not found');
  }
  const org = await prisma.org.findUniqueOrThrow({ where: { id: orgId } });
  const original =
    org.settings && typeof org.settings === 'object' && !Array.isArray(org.settings)
      ? org.settings
      : {};
  await prisma.org.update({
    where: { id: orgId },
    data: {
      settings: {
        ...original,
        defaultDestinationClassId: d.classId,
        defaultDestinationPartyId: d.partyId,
      },
    },
  });
}
