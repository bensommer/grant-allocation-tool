import { notFound } from 'next/navigation';
import { Field, FormBanner } from '@/components/form';
import { Button, ButtonLink, Card, PageHeader, Period } from '@/components/ui';
import { RELEASE_CLASS_LABEL } from '@/domain/periods';
import { decodeFormState, pick } from '@/lib/forms';
import { getOrgId } from '@/lib/org';
import { grantHeader } from '@/services/grant-workspace';
import { GrantTabs } from '../../tabs';
import { recordReportedPeriodAction } from '../actions';

export const dynamic = 'force-dynamic';

/** Enter a period that was reported to the funder before the app existed. */
export default async function ReportedPeriodPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ f?: string }>;
}) {
  const { id } = await params;
  const { f } = await searchParams;
  const grant = await grantHeader(await getOrgId(), id);
  if (!grant) notFound();
  const state = decodeFormState(f);
  const money = (name: string, label: string) => (
    <Field label={label} name={name} error={state?.errors[name]}>
      <input
        id={name}
        name={name}
        inputMode="decimal"
        placeholder="0.00"
        defaultValue={pick(state, name, '')}
        className="num"
      />
    </Field>
  );
  return (
    <>
      <PageHeader
        title={grant.name}
        subtitle={
          <>
            {grant.funder} · <Period from={grant.startDate} to={grant.endDate} />
          </>
        }
      />
      <GrantTabs id={id} active="periods" />
      <Card title="Record a reported period">
        <p className="muted mb-3 text-sm">
          Enter the figures exactly as they were reported. They become the period&apos;s figures
          of record for this grant; the books for the same dates are shown as drift, never used to
          overwrite them. Re-recording the same dates supersedes the earlier rows.
        </p>
        <FormBanner state={state} />
        <form
          action={recordReportedPeriodAction.bind(null, id)}
          className="grid gap-3 sm:grid-cols-2"
          data-testid="reported-period-form"
        >
          <Field label="Period name" name="name" error={state?.errors.name} hint="e.g. FY2025">
            <input id="name" name="name" required defaultValue={pick(state, 'name', '')} />
          </Field>
          <div />
          <Field label="From" name="from" error={state?.errors.from}>
            <input id="from" name="from" type="date" required defaultValue={pick(state, 'from', '')} />
          </Field>
          <Field label="To" name="to" error={state?.errors.to}>
            <input id="to" name="to" type="date" required defaultValue={pick(state, 'to', '')} />
          </Field>
          {money('received', 'Received ($)')}
          <div />
          {money('direct', `Released — ${RELEASE_CLASS_LABEL.direct} ($)`)}
          {money('staff', `Released — ${RELEASE_CLASS_LABEL.staff} ($)`)}
          {money('overhead', `Released — ${RELEASE_CLASS_LABEL.overhead} ($)`)}
          <div />
          <Field
            label="Note"
            name="note"
            error={state?.errors.note}
            hint="Where the figures came from (report, date, rounding)."
            className="sm:col-span-2"
          >
            <textarea id="note" name="note" rows={2} required defaultValue={pick(state, 'note', '')} />
          </Field>
          <div className="flex gap-2 sm:col-span-2">
            <Button type="submit">Record period</Button>
            <ButtonLink href={`/grants/${id}/periods`} variant="secondary">
              Cancel
            </ButtonLink>
          </div>
        </form>
      </Card>
    </>
  );
}
