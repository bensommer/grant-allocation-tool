'use server';

import { redirect } from 'next/navigation';
import { getOrgId } from '@/lib/org';
import { recalculateAfter } from '@/lib/after-mutation';
import { encodeFormState, str } from '@/lib/forms';
import {
  LAST_STEP,
  budgetRows,
  parseAward,
  parseBudget,
  parseLines,
  parsePastedBudget,
  type StepValues,
  type WizardStep,
} from '@/domain/grant-draft';
import {
  DraftIncompleteError,
  clearDraftCookie,
  draftCategories,
  draftLines,
  ensureDraft,
  finishDraft,
  proposedRules,
  saveStep,
  type Draft,
} from '@/services/grant-draft';
import { readTrackingFields, TRACKING_FIELDS } from '../tracking-form';
import { ValidationError } from '@/services/programs';

const stepUrl = (n: number) => `/grants/new/${n}`;

/** Everything posted except the intent button and React's own fields. */
function valuesOf(formData: FormData): StepValues {
  const values: StepValues = {};
  for (const key of new Set(formData.keys())) {
    if (key.startsWith('$') || key === 'intent') continue;
    const all = formData.getAll(key).filter((v): v is string => typeof v === 'string');
    values[key] = all.length > 1 ? all : (all[0] ?? '');
  }
  return values;
}

function backWithErrors(step: WizardStep, errors: Record<string, string>): never {
  redirect(`${stepUrl(step)}?f=${encodeFormState({ errors, values: {} })}`);
}

const next = (draft: Draft, step: WizardStep) =>
  Math.max(draft.step, Math.min(LAST_STEP, step + 1)) as WizardStep;

/**
 * One server action for every wizard step. `intent` (the submit button) is one of: continue
 * (default), save ("Save and finish later"), recount (step 2), paste / addrows (steps 3–4),
 * finish (step 5). Every intent stores the posted values first, so a refresh or browser Back
 * shows what was typed even when validation failed.
 */
export async function wizardStepAction(step: WizardStep, formData: FormData): Promise<void> {
  const orgId = await getOrgId();
  const intent = str(formData, 'intent') || 'continue';
  const draft = await ensureDraft(orgId);
  const values = valuesOf(formData);

  if (intent === 'save') {
    await saveStep(draft, step, values, { resumeAt: step });
    redirect('/grants?draft=1');
  }

  switch (step) {
    case 1: {
      const r = parseAward(values);
      await saveStep(draft, 1, values, r.ok ? { resumeAt: next(draft, 1) } : {});
      if (!r.ok) backWithErrors(1, r.errors);
      return redirect(stepUrl(2));
    }
    case 2: {
      if (intent === 'recount') {
        await saveStep(draft, 2, values);
        redirect(stepUrl(2));
      }
      const choice = str(formData, TRACKING_FIELDS.choice);
      const errors: Record<string, string> = {};
      if (choice === 'class' && !str(formData, TRACKING_FIELDS.classValue))
        errors['tracking'] = 'Choose the class, or pick another option';
      if (choice === 'project' && !str(formData, TRACKING_FIELDS.projectValue))
        errors['tracking'] = 'Choose the project or customer, or pick another option';
      if (choice !== 'class' && choice !== 'project' && choice !== 'neither')
        errors['tracking'] = 'Choose how QuickBooks tracks this grant';
      if (Object.keys(errors).length) {
        await saveStep(draft, 2, values);
        backWithErrors(2, errors);
      }
      const tracking = await readTrackingFields(orgId, formData);
      await saveStep(draft, 2, values, { resumeAt: next(draft, 2), tracking });
      return redirect(stepUrl(3));
    }
    case 3: {
      if (intent === 'paste') {
        // Pasted lines become rows after the ones already filled in; the textarea is emptied.
        const kept = budgetRows(values).filter((r) => r.code || r.name || r.amount);
        const rows = [...kept, ...parsePastedBudget(str(formData, 'paste'))];
        await saveStep(draft, 3, {
          ...values,
          paste: '',
          blankRows: '1',
          catCode: rows.map((r) => r.code),
          catName: rows.map((r) => r.name),
          catAmount: rows.map((r) => r.amount),
        });
        redirect(stepUrl(3));
      }
      if (intent === 'addrows') {
        await saveStep(draft, 3, { ...values, blankRows: String(blankRows(values) + 3) });
        redirect(stepUrl(3));
      }
      const r = parseBudget(values);
      await saveStep(draft, 3, values, r.ok ? { resumeAt: next(draft, 3) } : {});
      if (!r.ok) backWithErrors(3, r.errors);
      return redirect(stepUrl(4));
    }
    case 4: {
      const categories = draftCategories(draft);
      if (!categories) redirect(stepUrl(3));
      const hasLines = str(formData, 'hasLines');
      if (hasLines === 'no') {
        await saveStep(draft, 4, values, { resumeAt: next(draft, 4) });
        redirect(stepUrl(5));
      }
      if (hasLines !== 'yes') {
        await saveStep(draft, 4, values);
        backWithErrors(4, { hasLines: 'Choose yes or no' });
      }
      // "Yes" before the editor was shown: re-render step 4 with the nested editor.
      if (intent === 'addrows' || !('lineCat' in values)) {
        await saveStep(draft, 4, {
          ...values,
          blankRows: String(intent === 'addrows' ? blankRows(values) + 1 : blankRows(values)),
        });
        redirect(stepUrl(4));
      }
      const r = parseLines(values, categories);
      await saveStep(draft, 4, values, r.ok ? { resumeAt: next(draft, 4) } : {});
      if (!r.ok) backWithErrors(4, r.errors);
      return redirect(stepUrl(5));
    }
    case 5: {
      const saved = await saveStep(draft, 5, values, { resumeAt: 5 });
      const lines = draftLines(saved);
      if (!lines) redirect(stepUrl(4));
      const rows = await proposedRules(orgId, saved.data.tracking, lines);
      let grantId: string;
      try {
        grantId = await finishDraft(orgId, saved, rows, values);
      } catch (e) {
        if (e instanceof DraftIncompleteError) backWithErrors(e.step, { _: e.message });
        // Nothing was written (Finish is one transaction); show the reason on step 5.
        if (e instanceof ValidationError)
          backWithErrors(5, { _: Object.values(e.fieldErrors).join(' · ') });
        throw e;
      }
      await recalculateAfter(orgId, 'grant created (setup wizard)');
      await clearDraftCookie();
      return redirect(`/grants/${grantId}/todo?saved=1`);
    }
  }
}

function blankRows(values: StepValues): number {
  const n = Number(values['blankRows'] ?? 0);
  return Number.isFinite(n) && n > 0 ? n : 0;
}
