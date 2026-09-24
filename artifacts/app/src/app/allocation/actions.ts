'use server';

import { redirect } from 'next/navigation';
import { parseDateInput, toISODate } from '@/domain/dates';
import { type Matchers } from '@/domain/matchers';
import { parseMoneyToCents } from '@/domain/money';
import { getOrgId } from '@/lib/org';
import {
  bool,
  encodeFormState,
  list,
  redirectWithErrors,
  str,
  strOrNull,
  zodErrors,
} from '@/lib/forms';
import {
  allocationInputSchema,
  createAllocationRule,
  deleteAllocationRule,
  updateAllocationRule,
  upsertDriverValues,
} from '@/services/allocation';
import { ValidationError } from '@/services/programs';

function readRule(form: FormData) {
  const errors: Record<string, string> = {};
  const matchers: Matchers = {};
  for (const field of ['accountIds', 'classIds', 'locationIds', 'partyIds'] as const) {
    const items = list(form, field);
    if (items.length) matchers[field] = items;
  }
  const from = str(form, 'accountFrom'),
    to = str(form, 'accountTo');
  if (from || to) matchers.accountRange = { from, to };
  const description = str(form, 'descriptionContains');
  if (description) matchers.descriptionContains = description;
  for (const field of ['dateFrom', 'dateTo'] as const) {
    const raw = str(form, field);
    if (raw) {
      try {
        matchers[field] = toISODate(parseDateInput(raw));
      } catch {
        errors[field] = 'Enter a date as YYYY-MM-DD';
      }
    }
  }
  const date = (field: string) => {
    const raw = str(form, field);
    if (!raw) return null;
    try {
      return parseDateInput(raw);
    } catch {
      errors[field] = 'Enter a date as YYYY-MM-DD';
      return null;
    }
  };
  const targets = Array.from({ length: 6 }, (_, i) => {
    const programId = strOrNull(form, `program_${i}`);
    const grantBudgetLineId = strOrNull(form, `budgetLine_${i}`);
    const raw = str(form, `share_${i}`);
    if (!programId && !grantBudgetLineId && !raw) return null;
    let shareBps = 0;
    if (raw) {
      try {
        shareBps = parseMoneyToCents(raw);
        if (shareBps < 0 || shareBps > 10000) throw new Error();
      } catch {
        errors[`share_${i}`] = 'Enter a percentage from 0 to 100 with up to two decimals';
      }
    }
    return { sortOrder: i, programId, grantBudgetLineId, shareBps };
  }).filter((t): t is NonNullable<typeof t> => t !== null);
  const candidate = {
    name: str(form, 'name'),
    matchers,
    method: str(form, 'method'),
    driverKey: strOrNull(form, 'driverKey'),
    priority: Number(str(form, 'priority')),
    effectiveFrom: date('effectiveFrom'),
    effectiveTo: date('effectiveTo'),
    active: bool(form, 'active'),
    targets,
  };
  const parsed = allocationInputSchema.safeParse(candidate);
  if (!parsed.success) Object.assign(errors, { ...zodErrors(parsed.error), ...errors });
  return { errors, matchers, data: parsed.success ? parsed.data : null };
}

async function save(id: string | null, form: FormData): Promise<void> {
  const back = id ? `/allocation/${id}` : '/allocation/new';
  const result = readRule(form);
  if (str(form, 'intent') === 'preview') {
    const errors = { ...result.errors };
    const from = str(form, 'previewFrom'),
      to = str(form, 'previewTo');
    try {
      if (!from || !to || parseDateInput(from) > parseDateInput(to)) throw new Error();
    } catch {
      errors.previewFrom = 'Enter a valid preview range (YYYY-MM-DD), from on or before to';
    }
    const values: Record<string, string | string[]> = {};
    for (const key of new Set(form.keys())) {
      const all = form.getAll(key).filter((v): v is string => typeof v === 'string');
      values[key] = all.length > 1 ? all : (all[0] ?? '');
    }
    redirect(
      `${back}?f=${encodeFormState({ errors, values })}${errors.previewFrom ? '' : '&preview=1'}`,
    );
  }
  if (Object.keys(result.errors).length) redirectWithErrors(back, result.errors, form);
  const orgId = await getOrgId();
  try {
    const rule = id
      ? await updateAllocationRule(orgId, id, result.data!)
      : await createAllocationRule(orgId, result.data!);
    redirect(`/allocation/${rule.id}?saved=1`);
  } catch (error) {
    if (error instanceof ValidationError) redirectWithErrors(back, error.fieldErrors, form);
    throw error;
  }
}

export async function createAllocationAction(form: FormData): Promise<void> {
  await save(null, form);
}
export async function updateAllocationAction(id: string, form: FormData): Promise<void> {
  await save(id, form);
}
export async function deleteAllocationAction(id: string): Promise<void> {
  const result = await deleteAllocationRule(await getOrgId(), id);
  redirect(result.deactivated ? `/allocation/${id}?deactivated=1` : '/allocation?deleted=1');
}

export async function saveDriversAction(form: FormData): Promise<void> {
  const key = str(form, 'driverKey'),
    period = str(form, 'period');
  const back = `/allocation/drivers?key=${encodeURIComponent(key)}&period=${encodeURIComponent(period)}`;
  const rows = list(form, 'programIds').map((programId) => ({
    programId,
    value: Number(str(form, `value_${programId}`)),
  }));
  try {
    await upsertDriverValues(await getOrgId(), key, period, rows);
  } catch (error) {
    if (error instanceof ValidationError) redirectWithErrors(back, error.fieldErrors, form);
    throw error;
  }
  redirect(`${back}&saved=1`);
}
