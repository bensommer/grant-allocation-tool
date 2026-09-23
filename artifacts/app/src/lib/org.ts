import { prisma } from '@/lib/db';

/**
 * Single-organization deployment (MVP). Every table carries orgId so
 * multi-tenancy is additive later; for now there is exactly one Org row.
 */
export const DEFAULT_ORG_NAME = 'Default Organization';

let cachedOrgId: string | undefined;

export async function getOrgId(): Promise<string> {
  if (cachedOrgId) return cachedOrgId;
  const existing = await prisma.org.findFirst({ orderBy: { createdAt: 'asc' } });
  if (existing) {
    cachedOrgId = existing.id;
    return existing.id;
  }
  const created = await prisma.org.create({ data: { name: DEFAULT_ORG_NAME } });
  cachedOrgId = created.id;
  return created.id;
}

export function resetOrgCache(): void {
  cachedOrgId = undefined;
}
