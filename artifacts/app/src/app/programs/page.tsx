import {
  Banner,
  ButtonLink,
  DataTable,
  EmptyState,
  PageHeader,
  StatusPill,
  Th,
} from '@/components/ui';
import { prisma } from '@/lib/db';
import { getOrgId } from '@/lib/org';
import { CATEGORY_LABEL } from './labels';

export const dynamic = 'force-dynamic';

export default async function ProgramsPage({
  searchParams,
}: {
  searchParams: Promise<{ deleted?: string }>;
}) {
  const { deleted } = await searchParams;
  const orgId = await getOrgId();
  const [programs, classes] = await Promise.all([
    prisma.program.findMany({ where: { orgId }, orderBy: [{ active: 'desc' }, { code: 'asc' }] }),
    prisma.trackingClass.findMany({ where: { orgId, deletedAt: null } }),
  ]);
  const className = new Map(classes.map((c) => [c.id, c.name]));

  return (
    <>
      <PageHeader
        title="Programs"
        subtitle="Functional areas that expenses roll up to. Each imported class can be the default for one program."
        primaryAction={<ButtonLink href="/programs/new">New program</ButtonLink>}
      />
      {deleted ? <Banner tone="ok">Program deleted.</Banner> : null}
      {programs.length === 0 ? (
        <EmptyState
          title="No programs yet"
          action={<ButtonLink href="/programs/new">New program</ButtonLink>}
        />
      ) : (
        <DataTable caption="Programs">
          <thead>
            <tr>
              <Th>Program</Th>
              <Th>Functional category</Th>
              <Th>Default classes</Th>
              <Th>Status</Th>
            </tr>
          </thead>
          <tbody>
            {programs.map((p) => (
              <tr key={p.id}>
                <td>
                  <ButtonLink href={`/programs/${p.id}`} variant="ghost">
                    {p.name}
                  </ButtonLink>
                  <span className="muted block text-xs">{p.code}</span>
                </td>
                <td>
                  <StatusPill tone={p.functionalCategory === 'program' ? 'info' : 'muted'}>
                    {CATEGORY_LABEL[p.functionalCategory]}
                  </StatusPill>
                </td>
                <td>
                  {p.matchClassIds
                    .map((id) => className.get(id) ?? '(deleted class)')
                    .join(', ') || <span className="muted">–</span>}
                </td>
                <td>
                  <StatusPill tone={p.active ? 'ok' : 'muted'}>
                    {p.active ? 'Active' : 'Inactive'}
                  </StatusPill>
                </td>
              </tr>
            ))}
          </tbody>
        </DataTable>
      )}
    </>
  );
}
