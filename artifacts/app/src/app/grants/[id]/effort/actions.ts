'use server';

import { redirect } from 'next/navigation';
import { recalculateAfter } from '@/lib/after-mutation';
import { getOrgId } from '@/lib/org';
import { bool, list, redirectWithErrors, str, strOrNull } from '@/lib/forms';
import { MoneyParseError, parseMoneyToCents } from '@/domain/money';
import {
  carryVariance,
  createSchedule,
  updateSchedule,
  upsertEntry,
  type ScheduleInput,
} from '@/services/effort';
import {
  DestinationUnsetError,
  GrantCodingUnsetError,
  draftTrueUpForSchedule,
  voidDraft,
} from '@/services/correcting-entries';
import { ValidationError } from '@/services/programs';

function scheduleInput(formData: FormData, errors: Record<string, string>): ScheduleInput {
  let salaryCents: number | null = null;
  const salary = str(formData, 'salary');
  if (salary) {
    try {
      salaryCents = parseMoneyToCents(salary);
    } catch (e) {
      if (e instanceof MoneyParseError) errors['salaryCents'] = e.message;
      else throw e;
    }
  }
  const burden = str(formData, 'burdenBps');
  if (!/^\d+$/.test(burden)) errors['burdenBps'] = 'Burden: whole basis points (765 = 7.65%)';
  return {
    personLabel: str(formData, 'personLabel'),
    personPartyId: strOrNull(formData, 'personPartyId'),
    salaryCents,
    hourlyRate: strOrNull(formData, 'hourlyRate'),
    burdenBps: Number(burden),
    targetCategoryKey: str(formData, 'targetCategoryKey'),
    actualPayrollMatchers: {
      accountIds: list(formData, 'accountIds'),
      descriptionContainsAny: str(formData, 'descriptionContainsAny')
        .split(/[,;\n]/)
        .map((a) => a.trim())
        .filter((a) => a !== ''),
    },
    active: bool(formData, 'active'),
  };
}

export async function saveScheduleAction(grantId: string, formData: FormData): Promise<void> {
  const back = `/grants/${grantId}/effort`;
  const scheduleId = strOrNull(formData, 'scheduleId');
  const errors: Record<string, string> = {};
  const input = scheduleInput(formData, errors);
  if (Object.keys(errors).length > 0) redirectWithErrors(back, errors, formData);
  const orgId = await getOrgId();
  try {
    if (scheduleId) await updateSchedule(orgId, grantId, scheduleId, input);
    else await createSchedule(orgId, grantId, input);
  } catch (e) {
    if (e instanceof ValidationError) redirectWithErrors(back, e.fieldErrors, formData);
    throw e;
  }
  await recalculateAfter(orgId, `effort schedule ${scheduleId ? 'updated' : 'created'}`);
  redirect(`${back}?saved=1`);
}

export async function saveEntryAction(grantId: string, formData: FormData): Promise<void> {
  const back = `/grants/${grantId}/effort`;
  const scheduleId = str(formData, 'scheduleId');
  const override = str(formData, 'completedCountOverride');
  const errors: Record<string, string> = {};
  if (override && !/^\d+$/.test(override)) errors['completedCountOverride'] = 'Enter a whole number';
  const sortOrder = str(formData, 'sortOrder');
  if (sortOrder && !/^-?\d+$/.test(sortOrder)) errors['sortOrder'] = 'Enter a whole number';
  if (Object.keys(errors).length > 0) redirectWithErrors(back, errors, formData);
  const orgId = await getOrgId();
  try {
    await upsertEntry(orgId, grantId, scheduleId, {
      activityId: str(formData, 'activityId'),
      hoursPerOccurrence: str(formData, 'hoursPerOccurrence'),
      completedCountOverride: override ? Number(override) : null,
      sortOrder: sortOrder ? Number(sortOrder) : 0,
    });
  } catch (e) {
    if (e instanceof ValidationError) redirectWithErrors(back, e.fieldErrors, formData);
    throw e;
  }
  await recalculateAfter(orgId, 'effort count saved');
  redirect(`${back}?saved=1`);
}

export async function draftTrueUpAction(grantId: string, formData: FormData): Promise<void> {
  const back = `/grants/${grantId}/effort`;
  const orgId = await getOrgId();
  try {
    const draft = await draftTrueUpForSchedule(orgId, grantId, str(formData, 'scheduleId'));
    redirect(`/grants/${grantId}/entries?saved=1&drafted=${encodeURIComponent(draft.code)}`);
  } catch (e) {
    if (e instanceof DestinationUnsetError) redirect(`${back}?blocked=1`);
    if (e instanceof GrantCodingUnsetError) redirect(`${back}?blocked=grant`);
    if (e instanceof ValidationError) redirectWithErrors(back, e.fieldErrors, formData);
    throw e;
  }
}

export async function carryVarianceAction(grantId: string, formData: FormData): Promise<void> {
  const back = `/grants/${grantId}/effort`;
  const orgId = await getOrgId();
  try {
    await carryVariance(orgId, grantId, str(formData, 'scheduleId'), str(formData, 'note'));
  } catch (e) {
    if (e instanceof ValidationError) redirectWithErrors(back, e.fieldErrors, formData);
    throw e;
  }
  redirect(`${back}?saved=1`);
}

export async function voidDraftAction(grantId: string, formData: FormData): Promise<void> {
  const back = `/grants/${grantId}/entries`;
  const orgId = await getOrgId();
  try {
    await voidDraft(orgId, grantId, str(formData, 'draftId'), str(formData, 'note'));
  } catch (e) {
    if (e instanceof ValidationError) redirectWithErrors(back, e.fieldErrors, formData);
    throw e;
  }
  redirect(`${back}?saved=1`);
}
