import Link from 'next/link';
import { notFound } from 'next/navigation';
import { PageHeader } from '@/components/page-header';
import { prisma } from '@/lib/db';
import { getOrgId } from '@/lib/org';
import { decodeFormState } from '@/lib/forms';
import { deleteGrantAction, updateGrantAction } from '../actions';
import { GrantForm } from '../grant-form';
import { grantFormOptions } from '../options';
import { GrantTabs } from './tabs';

export const dynamic = 'force-dynamic';

export default async function GrantPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ f?: string; saved?: string; archived?: string }>;
}) {
  const { id } = await params;
  const { f, saved, archived } = await searchParams;
  const orgId = await getOrgId();
  const grant = await prisma.grant.findFirst({ where: { id, orgId }, include: { programs: true } });
  if (!grant) notFound();
  const opts = await grantFormOptions(orgId);
  return (
    <>
      <PageHeader
        title={grant.name}
        subtitle={grant.funder}
        actions={
          <>
            <Link href="/grants" className="btn btn-secondary btn-sm">
              All grants
            </Link>
            <Link href={`/grants/${id}/bva`} className="btn btn-secondary btn-sm">
              Budget vs actual
            </Link>
            <Link href={`/grants/${id}/narratives`} className="btn btn-secondary btn-sm">
              Narratives
            </Link>
            <form action={deleteGrantAction.bind(null, id)}>
              <button type="submit" className="btn btn-danger btn-sm">
                Delete / archive
              </button>
            </form>
          </>
        }
      />
      <GrantTabs id={id} active="detail" />
      {archived ? (
        <div className="banner banner-warn">
          This grant appears in a compute run, so it was archived rather than deleted.
        </div>
      ) : null}
      <GrantForm
        action={updateGrantAction.bind(null, id)}
        state={decodeFormState(f)}
        saved={!!saved}
        grant={grant}
        {...opts}
        submitLabel="Save changes"
      />
    </>
  );
}
