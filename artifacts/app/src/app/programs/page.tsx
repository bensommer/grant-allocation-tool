import Link from 'next/link';
import { PageHeader } from '@/components/page-header';
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
        actions={
          <Link href="/programs/new" className="btn">
            New program
          </Link>
        }
      />
      {deleted ? <div className="banner banner-ok">Program deleted.</div> : null}
      <div className="card">
        {programs.length === 0 ? (
          <p className="muted">
            No programs yet. Seed the demo (<code>npm run seed:demo</code>) or create one.
          </p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Code</th>
                <th>Name</th>
                <th>Functional category</th>
                <th>Default classes</th>
                <th>Active</th>
              </tr>
            </thead>
            <tbody>
              {programs.map((p) => (
                <tr key={p.id}>
                  <td>
                    <Link href={`/programs/${p.id}`}>{p.code}</Link>
                  </td>
                  <td>{p.name}</td>
                  <td>{CATEGORY_LABEL[p.functionalCategory]}</td>
                  <td>
                    {p.matchClassIds
                      .map((id) => className.get(id) ?? '(deleted class)')
                      .join(', ') || <span className="muted">–</span>}
                  </td>
                  <td>
                    {p.active ? (
                      <span className="pill pill-ok">Active</span>
                    ) : (
                      <span className="pill pill-muted">Inactive</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
}
