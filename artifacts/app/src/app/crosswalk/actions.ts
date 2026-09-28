'use server';

import { redirect } from 'next/navigation';
import { crosswalkBuilderOptions } from '@/components/rule-builder/options';
import { describeValues } from '@/components/rule-builder/describe';
import { recalculateAfter } from '@/lib/after-mutation';
import { getOrgId } from '@/lib/org';
import { redirectWithErrors, str } from '@/lib/forms';
import { formDataReader, readRuleValues } from '@/lib/rule-form';
import { parseRuleForm } from '@/lib/rule-form-parse';
import {
  createCrosswalkRule,
  deleteCrosswalkRule,
  updateCrosswalkRule,
} from '@/services/crosswalk';
import { ValidationError } from '@/services/programs';

async function save(back: string, id: string | null, formData: FormData): Promise<void> {
  // The no-JS Preview button bounces the form back and the page server-renders the preview.
  if (str(formData, 'intent') === 'preview') redirectWithErrors(`${back}?preview=1`, {}, formData);
  const orgId = await getOrgId();
  const options = await crosswalkBuilderOptions(orgId);
  const reader = formDataReader(formData);
  const suggested = describeValues(
    readRuleValues(reader, 'crosswalk'),
    'crosswalk',
    options,
  ).suggestedName;
  const parsed = parseRuleForm(reader, 'crosswalk', suggested);
  if (parsed.kind !== 'crosswalk' || !parsed.data || Object.keys(parsed.errors).length)
    redirectWithErrors(back, parsed.errors, formData);
  try {
    const rule = id
      ? await updateCrosswalkRule(orgId, id, parsed.data)
      : await createCrosswalkRule(orgId, parsed.data);
    await recalculateAfter(orgId, `crosswalk rule ${id ? 'updated' : 'created'}`);
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
  const orgId = await getOrgId();
  const r = await deleteCrosswalkRule(orgId, id);
  await recalculateAfter(
    orgId,
    r.deactivated ? 'crosswalk rule deactivated' : 'crosswalk rule deleted',
  );
  redirect(r.deactivated ? `/crosswalk/${id}?deactivated=1` : '/crosswalk?deleted=1');
}
