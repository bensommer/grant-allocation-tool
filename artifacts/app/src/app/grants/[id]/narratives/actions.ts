'use server';

import { redirect } from 'next/navigation';
import { getOrgId } from '@/lib/org';
import { redirectWithErrors, str } from '@/lib/forms';
import { narrativeModel } from '@/narratives/client';
import { templates, type Template } from '@/narratives/prompts';
import {
  createNarrative,
  getNarrative,
  regenerateSection,
  saveNarrative,
} from '@/narratives/service';
import { parseDraft } from '@/narratives/service';

export async function generateAction(grantId: string, formData: FormData): Promise<void> {
  const back = `/grants/${grantId}/narratives/new`;
  const model = narrativeModel();
  if (!model)
    redirectWithErrors(back, { _: 'Set ANTHROPIC_API_KEY to enable generation.' }, formData);
  try {
    const template = str(formData, 'template');
    if (!(template in templates)) throw new Error('Select a template.');
    const row = await createNarrative(
      await getOrgId(),
      grantId,
      {
        template: template as Template,
        from: str(formData, 'from'),
        to: str(formData, 'to'),
        contextNotes: str(formData, 'contextNotes'),
      },
      model,
    );
    redirect(`/grants/${grantId}/narratives/${row.id}?saved=1`);
  } catch (error) {
    if (error && typeof error === 'object' && 'digest' in error) throw error;
    redirectWithErrors(
      back,
      { _: error instanceof Error ? error.message : 'Generation failed. Please retry.' },
      formData,
    );
  }
}

export async function editAction(grantId: string, id: string, formData: FormData): Promise<void> {
  const back = `/grants/${grantId}/narratives/${id}`;
  try {
    const orgId = await getOrgId();
    const prior = await getNarrative(orgId, grantId, id);
    if (!prior) throw new Error('Narrative not found.');
    const previous = parseDraft(prior.editedJson ?? prior.draftJson);
    const draft = parseDraft({
      sections: previous.sections.map((s, i) => ({
        heading: s.heading,
        body: str(formData, `body-${i}`),
      })),
    });
    const row = await saveNarrative(
      orgId,
      grantId,
      id,
      draft,
      formData.getAll('acknowledge').filter((x): x is string => typeof x === 'string'),
      str(formData, 'intent') === 'approve',
    );
    redirect(`/grants/${grantId}/narratives/${row.id}?saved=1`);
  } catch (error) {
    if (error && typeof error === 'object' && 'digest' in error) throw error;
    redirectWithErrors(
      back,
      { _: error instanceof Error ? error.message : 'Could not save.' },
      formData,
    );
  }
}

export async function regenerateAction(
  grantId: string,
  id: string,
  index: number,
  formData: FormData,
): Promise<void> {
  const back = `/grants/${grantId}/narratives/${id}`;
  const model = narrativeModel();
  if (!model) redirectWithErrors(back, { _: 'Set ANTHROPIC_API_KEY to regenerate.' }, formData);
  try {
    await regenerateSection(await getOrgId(), grantId, id, index, model);
    redirect(`${back}?saved=1`);
  } catch (error) {
    if (error && typeof error === 'object' && 'digest' in error) throw error;
    redirectWithErrors(
      back,
      { _: error instanceof Error ? error.message : 'Regeneration failed.' },
      formData,
    );
  }
}
