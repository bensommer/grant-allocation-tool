'use server';

import { redirect } from 'next/navigation';
import { ZodError } from 'zod';
import { parseDateInput } from '@/domain/dates';
import { MoneyParseError, parseMoneyToCents } from '@/domain/money';
import { redirectWithErrors, str, zodErrors } from '@/lib/forms';
import { getOrgId } from '@/lib/org';
import { recordReportedPeriod, updateReportedPeriodNote } from '@/services/grant-periods';
import { ValidationError } from '@/services/programs';

const MONEY_FIELDS = ['direct', 'staff', 'overhead', 'received'] as const;

/** Record a period the bookkeeper reported before the app (JPH-23 AC7). */
export async function recordReportedPeriodAction(grantId: string, formData: FormData) {
  const back = `/grants/${grantId}/periods/reported`;
  const errors: Record<string, string> = {};
  const cents: Record<(typeof MONEY_FIELDS)[number], number> = {
    direct: 0,
    staff: 0,
    overhead: 0,
    received: 0,
  };
  for (const f of MONEY_FIELDS) {
    try {
      cents[f] = parseMoneyToCents(str(formData, f) || '0');
    } catch (e) {
      errors[f] = e instanceof MoneyParseError ? e.message : 'Enter a dollar amount';
    }
  }
  let periodFrom = new Date(NaN);
  let periodTo = new Date(NaN);
  try {
    periodFrom = parseDateInput(str(formData, 'from'));
  } catch {
    errors.from = 'Enter the start date as YYYY-MM-DD';
  }
  try {
    periodTo = parseDateInput(str(formData, 'to'));
  } catch {
    errors.to = 'Enter the end date as YYYY-MM-DD';
  }
  if (Object.keys(errors).length > 0) redirectWithErrors(back, errors, formData);
  try {
    await recordReportedPeriod(await getOrgId(), grantId, {
      name: str(formData, 'name'),
      periodFrom,
      periodTo,
      directCents: cents.direct,
      staffCents: cents.staff,
      overheadCents: cents.overhead,
      receivedCents: cents.received,
      note: str(formData, 'note'),
    });
  } catch (e) {
    if (e instanceof ValidationError) redirectWithErrors(back, e.fieldErrors, formData);
    if (e instanceof ZodError) {
      // Zod field names → form field names.
      const z = zodErrors(e);
      const map: Record<string, string> = {
        directCents: 'direct',
        staffCents: 'staff',
        overheadCents: 'overhead',
        receivedCents: 'received',
        periodFrom: 'from',
        periodTo: 'to',
      };
      redirectWithErrors(
        back,
        Object.fromEntries(Object.entries(z).map(([k, v]) => [map[k] ?? k, v])),
        formData,
      );
    }
    throw e;
  }
  redirect(`/grants/${grantId}/periods?saved=1`);
}

/** Only the note of a reported period is editable; its figures are locked. */
export async function updateReportedNoteAction(grantId: string, formData: FormData) {
  await updateReportedPeriodNote(
    await getOrgId(),
    grantId,
    str(formData, 'lockId'),
    str(formData, 'note'),
  );
  redirect(`/grants/${grantId}/periods?noted=1`);
}
