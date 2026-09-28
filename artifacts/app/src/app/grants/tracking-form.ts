/**
 * Server side of the tracking block: field names and the reader that turns a post into the
 * grant's stored fields. Kept out of actions.ts so it is not exposed as a server action.
 */
import { prisma } from '@/lib/db';
import { list, str, strOrNull } from '@/lib/forms';
import { NAME_PREFIX, trackingFieldsFromForm } from '@/domain/tracking-choice';

/** Posted field names of the tracking block (shared by the edit form and wizard step 2). */
export const TRACKING_FIELDS = {
  choice: 'trackingChoice',
  classValue: 'trackingClass',
  projectValue: 'trackingProject',
  classOverride: 'qboClassNameOverride',
  projectOverride: 'qboProjectNameOverride',
  extraClassIds: 'memberClassIds',
  extraPartyIds: 'memberPartyIds',
} as const;

/**
 * "How QuickBooks tracks this grant" (JPH-29 E3). A post without the radio (older clients,
 * scripted forms) falls back to the raw member / name fields, so nothing that worked before
 * stops working.
 */
export async function readTrackingFields(orgId: string, formData: FormData) {
  const choice = str(formData, TRACKING_FIELDS.choice);
  if (choice !== 'class' && choice !== 'project' && choice !== 'neither')
    return {
      memberClassIds: list(formData, 'memberClassIds'),
      memberPartyIds: list(formData, 'memberPartyIds'),
      qboClassName: strOrNull(formData, 'qboClassName'),
      qboProjectName: strOrNull(formData, 'qboProjectName'),
    };
  const classValue = str(formData, TRACKING_FIELDS.classValue);
  const projectValue = str(formData, TRACKING_FIELDS.projectValue);
  const [cls, party] = await Promise.all([
    choice === 'class' && classValue && !classValue.startsWith(NAME_PREFIX)
      ? prisma.trackingClass.findFirst({ where: { id: classValue, orgId }, select: { name: true } })
      : null,
    choice === 'project' && projectValue && !projectValue.startsWith(NAME_PREFIX)
      ? prisma.party.findFirst({
          where: { id: projectValue, orgId },
          select: { displayName: true },
        })
      : null,
  ]);
  return trackingFieldsFromForm({
    choice,
    classValue,
    projectValue,
    classOverride: str(formData, TRACKING_FIELDS.classOverride),
    projectOverride: str(formData, TRACKING_FIELDS.projectOverride),
    extraClassIds: list(formData, TRACKING_FIELDS.extraClassIds),
    extraPartyIds: list(formData, TRACKING_FIELDS.extraPartyIds),
    classNameOf: () => cls?.name ?? null,
    partyNameOf: () => party?.displayName ?? null,
  });
}
