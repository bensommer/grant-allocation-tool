import { prisma } from '../src/lib/db';

/** Server-rendered pages available for the current demo organization. */
export async function routes(): Promise<string[]> {
  const org = await prisma.org.findFirst({ orderBy: { createdAt: 'asc' } });
  if (!org) throw new Error('Demo organization missing. Restore fixtures/demo before running e2e.');
  const orgId = org.id;
  const [grant, batch, run, rule, allocation, program, line, period, narrative, grantRule] =
    await Promise.all([
      prisma.grant.findFirst({ where: { orgId }, orderBy: { name: 'asc' } }),
      prisma.importBatch.findFirst({ where: { orgId }, orderBy: { startedAt: 'desc' } }),
      prisma.computeRun.findFirst({ where: { orgId }, orderBy: { startedAt: 'desc' } }),
      prisma.crosswalkRule.findFirst({ where: { orgId } }),
      prisma.allocationRule.findFirst({ where: { orgId } }),
      prisma.program.findFirst({ where: { orgId } }),
      prisma.transactionLine.findFirst({ where: { orgId } }),
      prisma.periodLock.findFirst({ where: { orgId } }),
      prisma.narrative.findFirst({ where: { orgId } }),
      prisma.crosswalkRule.findFirst({ where: { orgId, grantId: { not: null } } }),
    ]);
  if (!grant || !batch || !run || !rule || !allocation || !program || !line)
    throw new Error('Demo records missing. Restore fixtures/demo before running e2e.');
  return [
    '/',
    '/grants',
    '/grants/new',
    `/grants/${grant.id}`,
    `/grants/${grant.id}/edit`,
    `/grants/${grant.id}/bva`,
    `/grants/${grant.id}/budget`,
    `/grants/${grant.id}/budget/import`,
    `/grants/${grant.id}/review`,
    `/grants/${grant.id}/review?show=all`,
    `/grants/${grant.id}/effort`,
    `/grants/${grant.id}/entries`,
    `/grants/${grant.id}/rules`,
    `/grants/${grant.id}/rules/new`,
    `/grants/${grant.id}/history`,
    `/grants/${grant.id}/narratives`,
    `/grants/${grant.id}/narratives/new`,
    `/grants/${grant.id}/delete`,
    '/restricted',
    '/import',
    `/import/${batch.id}`,
    `/import/${batch.id}/changes`,
    '/runs',
    `/runs/${run.id}`,
    `/runs/${run.id}/diff`,
    '/reports',
    '/reports/custom',
    '/reports/lines',
    '/crosswalk',
    '/crosswalk/new',
    `/crosswalk/${rule.id}`,
    `/crosswalk/${rule.id}/delete`,
    '/crosswalk/matrix',
    '/crosswalk/lines',
    '/crosswalk/coverage',
    '/crosswalk/conflicts',
    '/allocation',
    '/allocation/new',
    `/allocation/${allocation.id}`,
    `/allocation/${allocation.id}/delete`,
    '/allocation/drivers',
    '/programs',
    '/programs/new',
    `/programs/${program.id}`,
    `/programs/${program.id}/delete`,
    '/accounts',
    '/narratives',
    '/settings',
    '/settings/periods',
    `/lines/${line.id}`,
    ...(period ? [`/periods/${period.id}/drift`] : []),
    ...(narrative ? [`/grants/${narrative.grantId}/narratives/${narrative.id}`] : []),
    ...(grantRule ? [`/grants/${grantRule.grantId}/rules/${grantRule.id}`] : []),
  ];
}
