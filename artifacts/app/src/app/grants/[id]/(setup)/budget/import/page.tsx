import { notFound } from 'next/navigation';
import { PageHeader } from '@/components/page-header';
import { Field, FormBanner } from '@/components/form';
import { prisma } from '@/lib/db';
import { getOrgId } from '@/lib/org';
import { decodeFormState, pick } from '@/lib/forms';
import { importBudgetLinesAction } from '@/app/grants/actions';
import { EditGrantButton } from '@/app/grants/[id]/edit-grant-button';
import { GrantTabs } from '@/app/grants/[id]/tabs';

export const dynamic = 'force-dynamic';

export default async function ImportBudgetPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ f?: string }>;
}) {
  const { id } = await params;
  const { f } = await searchParams;
  const orgId = await getOrgId();
  const grant = await prisma.grant.findFirst({ where: { id, orgId } });
  if (!grant) notFound();
  const state = decodeFormState(f);
  return (
    <>
      <PageHeader
        title={`${grant.name} · import budget lines`}
        subtitle="Paste or upload CSV with columns: code, name, budget, program_code. Existing codes are updated."
        secondaryActions={<EditGrantButton id={id} />}
      />
      <GrantTabs id={id} active="budget" />
      <form
        action={importBudgetLinesAction.bind(null, id)}

        className="card"
      >
        <FormBanner state={state} />
        <div className="grid-form">
          <Field label="CSV text" name="csv" className="md:col-span-2">
            <textarea
              id="csv"
              name="csv"
              rows={8}
              placeholder={'code,name,budget,program_code\nPERS,Personnel,72000.00,CT'}
              defaultValue={pick(state, 'csv', '')}
            />
            {state?.errors['csv'] ? (
              <pre className="field-error whitespace-pre-wrap">{state.errors['csv']}</pre>
            ) : null}
          </Field>
          <Field label="…or upload a file" name="file">
            <input id="file" type="file" name="file" accept=".csv,text/csv" />
          </Field>
        </div>
        <div className="mt-4">
          <button type="submit" className="btn">
            Import
          </button>
        </div>
      </form>
    </>
  );
}
