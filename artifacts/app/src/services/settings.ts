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
