'use server';

import { redirect } from 'next/navigation';
import { getOrgId } from '@/lib/org';
import { bool, list, redirectWithErrors, str, strOrNull, zodErrors } from '@/lib/forms';
import {
  createProgram,
  deleteProgram,
  programInputSchema,
  updateProgram,
  ValidationError,
} from '@/services/programs';

function parse(formData: FormData) {
  return programInputSchema.safeParse({
    code: str(formData, 'code').toUpperCase(),
    name: str(formData, 'name'),
    description: strOrNull(formData, 'description'),
    functionalCategory: str(formData, 'functionalCategory'),
    matchClassIds: list(formData, 'matchClassIds'),
    active: bool(formData, 'active'),
  });
}

export async function createProgramAction(formData: FormData): Promise<void> {
  const parsed = parse(formData);
  if (!parsed.success) redirectWithErrors('/programs/new', zodErrors(parsed.error), formData);
  const orgId = await getOrgId();
  let id: string;
  try {
    id = (await createProgram(orgId, parsed.data)).id;
  } catch (e) {
    if (e instanceof ValidationError) redirectWithErrors('/programs/new', e.fieldErrors, formData);
    throw e;
  }
  redirect(`/programs/${id}?saved=1`);
}

export async function updateProgramAction(id: string, formData: FormData): Promise<void> {
  const parsed = parse(formData);
  if (!parsed.success) redirectWithErrors(`/programs/${id}`, zodErrors(parsed.error), formData);
  const orgId = await getOrgId();
  try {
    await updateProgram(orgId, id, parsed.data);
  } catch (e) {
    if (e instanceof ValidationError)
      redirectWithErrors(`/programs/${id}`, e.fieldErrors, formData);
    throw e;
  }
  redirect(`/programs/${id}?saved=1`);
}

export async function deleteProgramAction(id: string): Promise<void> {
  const orgId = await getOrgId();
  const r = await deleteProgram(orgId, id);
  redirect(r.deleted ? '/programs?deleted=1' : `/programs/${id}?deactivated=1`);
}
