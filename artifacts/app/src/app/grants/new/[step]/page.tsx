import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { Money } from '@/components/ui';
import { TERMS } from '@/copy/terms';
import {
  INCOME_FIELDS,
  incomeSelections,
  parseAward,
  wizardStep,
  type DraftCategory,
  type WizardStep,
} from '@/domain/grant-draft';
import { decodeFormState, type FormState } from '@/lib/forms';
import { getOrgId } from '@/lib/org';
import { prisma } from '@/lib/db';
import {
  draftCategories,
  draftLines,
  loadDraft,
  proposedRules,
  stepValues,
  type Draft,
} from '@/services/grant-draft';
import { trackingOptions } from '@/services/tracking-options';
import { GrantIncomeBlock, TrackingBlock } from '../../tracking-block';
import { wizardStepAction } from '../wizard-actions';
import { WizardShell } from '../wizard/shell';
import { StepAward } from '../wizard/step-award';
import { StepBudget, TotalChip } from '../wizard/step-budget';
import { StepLines } from '../wizard/step-lines';
import { StepRules } from '../wizard/step-rules';

export const dynamic = 'force-dynamic';

/** Stored values of the step plus any errors the action redirected back with. */
function stateFor(draft: Draft | null, step: WizardStep, f: string | undefined): FormState {
  const posted = decodeFormState(f);
  return { errors: posted?.errors ?? {}, values: stepValues(draft, step) };
}

function awardOf(draft: Draft | null) {
  const r = parseAward(stepValues(draft, 1));
  return r.ok ? r.data : null;
}

export default async function WizardStepPage({
  params,
  searchParams,
}: {
  params: Promise<{ step: string }>;
  searchParams: Promise<{ f?: string }>;
}) {
  const step = wizardStep((await params).step);
  if (!step) notFound();
  const { f } = await searchParams;
  const orgId = await getOrgId();
  const draft = await loadDraft(orgId);
  const reached = draft?.step ?? 1;
  const state = stateFor(draft, step, f);
  const action = wizardStepAction.bind(null, step);
  const award = awardOf(draft);
  // Later steps need the earlier ones; send the browser back rather than render half a step.
  if (step >= 2 && !award) redirect('/grants/new/1');
  let categories: DraftCategory[] | null = null;
  if (step >= 4) {
    categories = draftCategories(draft);
    if (!categories) redirect('/grants/new/3');
  }

  switch (step) {
    case 1: {
      const customers = await prisma.party.findMany({
        where: { orgId, kind: 'customer', deletedAt: null },
        orderBy: { displayName: 'asc' },
        select: { id: true, displayName: true },
      });
      return (
        <WizardShell
          step={1}
          reached={reached}
          title="The award"
          lede="Copy these from the award letter; everything else builds on them."
          action={action}
          state={state}
        >
          <StepAward state={state} customers={customers} />
        </WizardShell>
      );
    }
    case 2: {
      const options = await trackingOptions(orgId);
      // The funder's own customer is the default receipts source until the block is posted;
      // afterwards what the user left checked stands, including nothing.
      const income = incomeSelections(
        state.values,
        options.parties.find((p) => p.kind === 'customer' && p.name === award!.funderText)?.id ??
          null,
      );
      return (
        <WizardShell
          step={2}
          reached={reached}
          title={TERMS.howQuickBooksTracks}
          lede="Pick the one thing in QuickBooks that marks a transaction as this grant's. The count updates when you press Update count."
          action={action}
          state={state}
        >
          <div className="grid gap-3">
            <TrackingBlock state={state} grant={null} options={options} />
            <input type="hidden" name={INCOME_FIELDS.posted} value="1" />
            <GrantIncomeBlock
              state={state}
              grant={income}
              customers={options.parties
                .filter((p) => p.kind === 'customer')
                .map((p) => ({ id: p.id, displayName: p.name }))}
              classes={options.classes.map((c) => ({ id: c.id, name: c.name }))}
            />
          </div>
        </WizardShell>
      );
    }
    case 3:
      return (
        <WizardShell
          step={3}
          reached={reached}
          title="Funder budget"
          lede={
            <>
              The categories on the award letter, with their amounts. Award:{' '}
              <Money cents={award!.awardAmountCents} />.
            </>
          }
          action={action}
          state={state}
        >
          <StepBudget state={state} awardCents={award!.awardAmountCents} />
        </WizardShell>
      );
    case 4:
      return (
        <WizardShell
          step={4}
          reached={reached}
          title="Working lines (optional)"
          lede="Working lines are how you track spending day to day; they roll up into the funder's categories."
          action={action}
          state={state}
        >
          <StepLines state={state} categories={categories!} />
        </WizardShell>
      );
    case 5: {
      const lines = draftLines(draft);
      if (!lines) redirect('/grants/new/4');
      if (!draft?.data.tracking) redirect('/grants/new/2');
      const rows = await proposedRules(orgId, draft.data.tracking, lines);
      const categoryTotal = categories!.reduce((a, c) => a + c.budgetCents, 0);
      return (
        <WizardShell
          step={5}
          reached={reached}
          title="Starting rules"
          lede="Where each account's transactions should go. Anything you leave as “Decide later” waits in Review."
          action={action}
          state={state}
          continueLabel="Finish and create the grant"
          continueIntent="finish"
        >
          <div className="grid gap-3">
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <TotalChip
                totalCents={categoryTotal}
                awardCents={award!.awardAmountCents}
                label="Budget"
                testId="summary-total-chip"
              />
              <span className="muted">
                {categories!.length} categor{categories!.length === 1 ? 'y' : 'ies'}, {lines.length}{' '}
                working line{lines.length === 1 ? '' : 's'}.{' '}
                <Link href="/grants/new/3">Change</Link>
              </span>
            </div>
            <StepRules state={state} grantName={award!.name} rows={rows} lines={lines} />
          </div>
        </WizardShell>
      );
    }
  }
}
