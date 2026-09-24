'use server';

import { redirect } from 'next/navigation';
import { parseDateInput } from '@/domain/dates';
import { getOrgId } from '@/lib/org';
import { bool, list, redirectWithErrors, str, zodErrors } from '@/lib/forms';
import {
  createCrosswalkRule,
  crosswalkInputSchema,
  deleteCrosswalkRule,
  updateCrosswalkRule,
} from '@/services/crosswalk';
import { ValidationError } from '@/services/programs';

function parse(formData: FormData) {
  const from = str(formData, 'accountFrom');
  const to = str(formData, 'accountTo');
  const matchers = {
    programIds: list(formData, 'programIds'),
    accountIds: list(formData, 'accountIds'),
    ...(from || to ? { accountRange: { from, to } } : {}),
    classIds: list(formData, 'classIds'),
    locationIds: list(formData, 'locationIds'),
    partyIds: list(formData, 'partyIds'),
    descriptionContains: str(formData, 'descriptionContains'),
    ...(str(formData, 'dateFrom') ? { dateFrom: str(formData, 'dateFrom') } : {}),
    ...(str(formData, 'dateTo') ? { dateTo: str(formData, 'dateTo') } : {}),
  };
  const result = crosswalkInputSchema.safeParse({
    name: str(formData, 'name'),
    grantBudgetLineId: str(formData, 'grantBudgetLineId'),
    priority: Number(str(formData, 'priority')),
    active: bool(formData, 'active'),
    matchers,
  });
  const errors = result.success ? {} : zodErrors(result.error);
  if ((from && !to) || (!from && to)) errors['accountRange'] = 'Enter both range endpoints';
  if (
    from &&
    to &&
    from > to &&
    !(Number.isFinite(Number(from)) && Number.isFinite(Number(to)) && Number(from) <= Number(to))
  )
    errors['accountRange'] = 'Range start must be before end';
  if (matchers.dateFrom && matchers.dateTo && matchers.dateFrom > matchers.dateTo)
    errors['matchers.dateTo'] = 'End date must be on or after start';
  return { data: result.success ? result.data : null, errors };
}

async function save(back: string, id: string | null, formData: FormData): Promise<void> {
  if (str(formData, 'intent') === 'preview') {
    const errors: Record<string, string> = {};
    try {
      if (parseDateInput(str(formData, 'previewFrom')) > parseDateInput(str(formData, 'previewTo')))
        errors['previewTo'] = 'End date must be on or after start';
    } catch {
      errors['previewFrom'] = 'Enter valid preview dates';
    }
    redirectWithErrors(
      errors['previewFrom'] || errors['previewTo'] ? back : `${back}?preview=1`,
      errors,
      formData,
    );
  }
  const parsed = parse(formData);
  if (!parsed.data || Object.keys(parsed.errors).length)
    redirectWithErrors(back, parsed.errors, formData);
  const orgId = await getOrgId();
  try {
    const rule = id
      ? await updateCrosswalkRule(orgId, id, parsed.data)
      : await createCrosswalkRule(orgId, parsed.data);
    redirect(`/crosswalk/${rule.id}?saved=1`);
  } catch (e) {
    if (e instanceof ValidationError) redirectWithErrors(back, e.fieldErrors, formData);
    throw e;
  }
}

export async function createCrosswalkAction(formData: FormData): Promise<void> {
  await save('/crosswalk/new', null, formData);
}
export async function updateCrosswalkAction(id: string, formData: FormData): Promise<void> {
  await save(`/crosswalk/${id}`, id, formData);
}
export async function deleteCrosswalkAction(id: string): Promise<void> {
  const r = await deleteCrosswalkRule(await getOrgId(), id);
  redirect(r.deactivated ? `/crosswalk/${id}?deactivated=1` : '/crosswalk?deleted=1');
}
