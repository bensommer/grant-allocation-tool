import { PageHeader } from '@/components/page-header';
import { prisma } from '@/lib/db';
import { getOrgId } from '@/lib/org';
import { decodeFormState } from '@/lib/forms';
import { createProgramAction } from '../actions';
import { ProgramForm } from '../program-form';
import { classOptions } from '../class-options';

export const dynamic = 'force-dynamic';

export default async function NewProgramPage({
  searchParams,
}: {
  searchParams: Promise<{ f?: string }>;
}) {
  const { f } = await searchParams;
  const orgId = await getOrgId();
  const classes = await classOptions(prisma, orgId, null);
  return (
    <>
      <PageHeader title="New program" />
      <ProgramForm
        action={createProgramAction}
        state={decodeFormState(f)}
        program={null}
        classes={classes}
        submitLabel="Create program"
      />
    </>
  );
}
