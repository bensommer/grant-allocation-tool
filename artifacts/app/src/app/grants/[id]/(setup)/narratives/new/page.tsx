import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Card, PageHeader } from '@/components/ui';
import { prisma } from '@/lib/db';
import { getOrgId } from '@/lib/org';
import { decodeFormState, pick } from '@/lib/forms';
import { narrativeModel } from '@/narratives/client';
import { templates } from '@/narratives/prompts';
import { generateAction } from '../actions';

export const dynamic = 'force-dynamic';
export default async function NewNarrative({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ f?: string }>;
}) {
  const { id } = await params;
  const grant = await prisma.grant.findFirst({ where: { orgId: await getOrgId(), id } });
  if (!grant) notFound();
  const state = decodeFormState((await searchParams).f);
  const model = narrativeModel();
  return (
    <>
      <PageHeader
        title="Draft a funder narrative"
        secondaryActions={
          <Link className="btn btn-secondary btn-sm" href={`/grants/${id}/narratives`}>
            ← Narratives
          </Link>
        }
      />
      {!model ? (
        <div className="banner banner-warn">
          Generation is disabled. Set ANTHROPIC_API_KEY and NARRATIVE_MODEL to enable it.
        </div>
      ) : (
        <Card title="Draft details">
          <form className="grid-form" action={generateAction.bind(null, id)}>
            {state?.errors._ && (
              <div className="banner banner-warn" role="alert">
                {state.errors._} Retry generation below.
              </div>
            )}
            <label>
              Template
              <select
                name="template"
                defaultValue={pick(state, 'template', 'Quarterly financial narrative')}
              >
                {Object.keys(templates).map((t) => (
                  <option key={t}>{t}</option>
                ))}
              </select>
            </label>
            <label>
              Period from
              <input
                type="date"
                name="from"
                required
                defaultValue={pick(state, 'from', grant.startDate.toISOString().slice(0, 10))}
              />
            </label>
            <label>
              Period to
              <input
                type="date"
                name="to"
                required
                defaultValue={pick(state, 'to', grant.endDate.toISOString().slice(0, 10))}
              />
            </label>
            <label>
              Context notes
              <textarea
                name="contextNotes"
                rows={5}
                defaultValue={pick(state, 'contextNotes', '')}
              />
            </label>
            <button className="btn" type="submit">
              Generate draft
            </button>
          </form>
        </Card>
      )}
    </>
  );
}
