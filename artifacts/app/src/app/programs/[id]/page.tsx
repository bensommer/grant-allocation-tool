import Link from 'next/link';
import { notFound } from 'next/navigation';
import { PageHeader } from '@/components/page-header';
import { prisma } from '@/lib/db';
import { getOrgId } from '@/lib/org';
import { decodeFormState } from '@/lib/forms';
import { deleteProgramAction, updateProgramAction } from '../actions';
import { ProgramForm } from '../program-form';
import { classOptions } from '../class-options';

export const dynamic = 'force-dynamic';

export default async function ProgramPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ f?: string; saved?: string; deactivated?: string }>;
}) {
  const { id } = await params;
  const { f, saved, deactivated } = await searchParams;
  const orgId = await getOrgId();
  const program = await prisma.program.findFirst({ where: { id, orgId } });
  if (!program) notFound();
  const classes = await classOptions(prisma, orgId, id);
  const update = updateProgramAction.bind(null, id);
  const remove = deleteProgramAction.bind(null, id);
  return (
    <>
      <PageHeader
        title={`${program.code} · ${program.name}`}
        actions={
          <>
            <Link href="/programs" className="btn btn-secondary btn-sm">
              All programs
            </Link>
            <form action={remove}>
              <button type="submit" className="btn btn-danger btn-sm">
                Delete
              </button>
            </form>
          </>
        }
      />
      {deactivated ? (
        <div className="banner banner-warn">
          This program is referenced by grants, rules or compute runs, so it was deactivated instead
          of deleted.
        </div>
      ) : null}
      <ProgramForm
        action={update}
        state={decodeFormState(f)}
        saved={!!saved}
        program={program}
        classes={classes}
        submitLabel="Save changes"
      />
    </>
  );
}
